import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import { pool } from '../../shared/db/pool.js';
import { redis } from '../../shared/services/redis.service.js';
import { pgDecryptFields } from '../../shared/db/pgcrypto.js';
import { logger } from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Email service (lazy import to avoid circular dependency)
// ---------------------------------------------------------------------------
let _emailService = null;
async function getEmailService() {
  if (!_emailService) {
    _emailService = await import('../../shared/services/email.service.js');
  }
  return _emailService;
}

// ---------------------------------------------------------------------------
// Key loading — RS256 key pair from env-specified paths
// ---------------------------------------------------------------------------
const PRIVATE_KEY = fs.readFileSync(process.env.JWT_PRIVATE_KEY_PATH, 'utf8');
const PUBLIC_KEY  = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH,  'utf8');

const ACCESS_TOKEN_TTL  = 15 * 60;          // 15 minutes (seconds)
const REFRESH_TOKEN_TTL = 7  * 24 * 60 * 60; // 7 days (seconds)
const OTP_TTL           = 10 * 60;           // 10 minutes (seconds)
const LOGIN_WINDOW      = 15 * 60;           // 15 minutes (seconds)
const MAX_LOGIN_ATTEMPTS = 5;

const refreshKey  = (token)  => `refresh:${token}`;
const otpKey      = (userId) => `otp:${userId}`;
const loginKey    = (ip, user) => `login_attempts:${ip}:${user}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function generateOpaqueToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generateOtp() {
  // 6-digit numeric OTP — CSPRNG (crypto.randomInt is inclusive on min, exclusive on max)
  return String(crypto.randomInt(100000, 1000000));
}

async function getUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT u.id, u.password_hash, u.is_active, u.must_change_password,
            u.first_name, u.last_name, u.department_id, u.twofa_enabled,
            pgp_sym_decrypt(decode(u.email, 'hex'), $2) AS email,
            array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE (
       u.employee_id = $1
       OR u.id IN (SELECT user_id FROM patients WHERE mrn = $1 AND deleted_at IS NULL AND user_id IS NOT NULL)
     )
     AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [username, process.env.PG_CRYPTO_KEY]
  );
  return rows[0] || null;
}

async function getUserById(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.is_active, u.must_change_password, u.first_name, u.last_name,
            u.department_id, u.email,
            array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [userId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export async function login(username, password, ip, userAgent = '') {
  const attemptKey = loginKey(ip, username);
  const attempts   = await redis.incr(attemptKey);
  if (attempts === 1) await redis.expire(attemptKey, LOGIN_WINDOW);

  if (attempts > MAX_LOGIN_ATTEMPTS) {
    const ttl = await redis.ttl(attemptKey);
    const err  = new Error(`Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`);
    err.status = 429;
    logger.warn('LOGIN_RATE_LIMITED', { event: 'LOGIN_RATE_LIMITED', username, ip });
    throw err;
  }

  if (attempts === MAX_LOGIN_ATTEMPTS) {
    const user = await getUserByUsername(username);
    if (user) {
      await sendLockoutNotification(user, ip);
    }
  }

  const user = await getUserByUsername(username);
  if (!user) {
    logger.warn('LOGIN_FAILURE', { event: 'LOGIN_FAILURE', username, ip });
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    logger.warn('LOGIN_FAILURE', { event: 'LOGIN_FAILURE', username, ip });
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  if (!user.is_active) {
    const err = new Error('Account is disabled');
    err.status = 403;
    throw err;
  }

  await redis.del(attemptKey);

  if (user.must_change_password) {
    return { mustChangePassword: true };
  }

  // Check if 2FA is enabled for this user
  if (user.twofa_enabled) {
    await sendTwoFaLoginOtp(user.id, user.email);
    return { requires2fa: true, userId: user.id };
  }

  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  const ipHash         = hashField(ip);
  const uaHash         = hashField(userAgent);
  const expiresAt      = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);
  const { rows: ses }  = await pool.query(
    `INSERT INTO sessions (user_id, ip_hash, user_agent_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, ipHash, uaHash, expiresAt]
  );
  const sessionId = ses[0].id;

  const tokens = await issueTokenPair(user, sessionId);
  logger.info('LOGIN_SUCCESS', { event: 'LOGIN_SUCCESS', userId: user.id, ip });
  return { user: sanitizeUser(user), ...tokens };
}

// ---------------------------------------------------------------------------
// Issue access + refresh token pair
// ---------------------------------------------------------------------------
export async function issueTokenPair(user, sessionId = null) {
  // Normalize roles — pg array_agg can return '{ROLE1,ROLE2}' string
  let roles = user.roles ?? [];
  if (typeof roles === 'string') {
    roles = roles.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  }

  const payload = {
    sub:          user.id,
    roles,
    departmentId: user.department_id,
    firstName:    user.first_name,
    lastName:     user.last_name,
    ...(sessionId && { sessionId }),
  };

  const accessToken = jwt.sign(payload, PRIVATE_KEY, {
    algorithm : 'RS256',
    expiresIn : ACCESS_TOKEN_TTL,
    issuer    : process.env.JWT_ISSUER || 'hms',
    audience  : process.env.JWT_AUDIENCE || 'hms-client',
  });

  const refreshToken = generateOpaqueToken();

  // Store refresh token in Redis: value = JSON({userId, sessionId}), TTL = 7 days
  await redis.setex(refreshKey(refreshToken), REFRESH_TOKEN_TTL, JSON.stringify({ userId: user.id, sessionId }));

  return { accessToken, refreshToken };
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
export async function refresh(oldRefreshToken) {
  if (!oldRefreshToken) {
    const err = new Error('No refresh token');
    err.status = 401;
    throw err;
  }

  const stored   = await redis.get(refreshKey(oldRefreshToken));
  if (!stored) {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }

  // Rotate: delete old token immediately (single-use)
  await redis.del(refreshKey(oldRefreshToken));

  const { userId, sessionId } = JSON.parse(stored);

  const { rows } = await pool.query(
    `SELECT u.id, u.is_active, u.first_name, u.last_name, u.department_id,
            array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [userId]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    const err = new Error('User not found or inactive');
    err.status = 401;
    throw err;
  }

  const tokens = await issueTokenPair(user, sessionId);
  logger.info('TOKEN_REFRESH', { event: 'TOKEN_REFRESH', userId });
  return tokens;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
export async function logout(refreshToken) {
  if (refreshToken) {
    await redis.del(refreshKey(refreshToken));
  }
  logger.info('LOGOUT', { event: 'LOGOUT' });
}

// ---------------------------------------------------------------------------
// Request OTP (for change-password flow)
// ---------------------------------------------------------------------------
export async function requestOtp(username) {
  const user = await getUserByUsername(username);
  if (!user) return;

  const otp = generateOtp();
  await redis.setex(otpKey(user.id), OTP_TTL, otp);

  const { sendOTP } = await import('../../shared/services/email.service.js');
  if (user.email) {
    await sendOTP(user.email, otp);
  }

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`[DEV] OTP for ${user.id}: ${otp}`);
  }
}

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------
export async function changePassword(username, otp, newPassword) {
  const user = await getUserByUsername(username);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const storedOtp = await redis.get(otpKey(user.id));
  if (!storedOtp || storedOtp !== otp) {
    const err = new Error('Invalid or expired OTP');
    err.status = 400;
    throw err;
  }

  await redis.del(otpKey(user.id));

  const hash = await argon2.hash(newPassword, {
    type       : argon2.argon2id,
    memoryCost : 65536,
    timeCost   : 3,
    parallelism: 4,
  });

  await pool.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2`,
    [hash, user.id]
  );

  return { success: true };
}

// ---------------------------------------------------------------------------
// Force logout all — called by midnight cron
// ---------------------------------------------------------------------------
export async function flushAllRefreshTokens() {
  const keys = await redis.keys('refresh:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  logger.info(`[cron] Flushed ${keys.length} refresh tokens`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sanitizeUser(user) {
  const roles = Array.isArray(user.roles)
    ? user.roles
    : typeof user.roles === 'string'
      ? user.roles.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
      : [];
  return {
    id          : user.id,
    firstName   : user.first_name,
    lastName    : user.last_name,
    roles,
    departmentId: user.department_id,
  };
}

// ---------------------------------------------------------------------------
// Account lockout notification
// ---------------------------------------------------------------------------
async function sendLockoutNotification(user, ip) {
  try {
    const emailSvc = await getEmailService();

    // Decrypt user email for sending
    const decryptedUser = await pgDecryptFields(user, ['email']);
    const userEmail = decryptedUser.email;

    const html = emailSvc.baseTemplate('Account Locked — Multiple Failed Login Attempts', `
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Account Locked</h2>
      <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">
        Multiple failed login attempts have been detected on your account.
      </p>
      <div style="background:#fee2e2;border-radius:6px;padding:16px 24px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#991b1b;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
          Details
        </p>
        <p style="margin:0;color:#7f1d1d;font-size:14px;">
          User: <strong>${user.first_name} ${user.last_name}</strong><br/>
          IP Address: <strong>${ip}</strong><br/>
          Attempts: <strong>${MAX_LOGIN_ATTEMPTS}</strong>
        </p>
      </div>
      <p style="margin:0 0 12px;color:#374151;font-size:14px;">
        If this was you, please wait 15 minutes and try again. If you did not attempt to log in,
        please contact IT support immediately.
      </p>
    `);

    // Notify the locked-out user
    if (userEmail) {
      await emailSvc.sendNotification(
        userEmail,
        `Account Locked — ${process.env.HOSPITAL_NAME || 'HMS'}`,
        html
      );
    }

    // Notify SUPER_ADMIN
    if (process.env.SUPER_ADMIN_EMAIL) {
      const adminHtml = emailSvc.baseTemplate('Security Alert — Account Lockout', `
        <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Account Lockout Detected</h2>
        <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">
          An account has been locked due to multiple failed login attempts.
        </p>
        <div style="background:#fef3c7;border-radius:6px;padding:16px 24px;margin:24px 0;">
          <p style="margin:0 0 8px;color:#92400e;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
            Incident Details
          </p>
          <p style="margin:0;color:#78350f;font-size:14px;">
            User ID: <strong>${user.id}</strong><br/>
            Name: <strong>${user.first_name} ${user.last_name}</strong><br/>
            IP Address: <strong>${ip}</strong><br/>
            Failed Attempts: <strong>${MAX_LOGIN_ATTEMPTS}</strong>
          </p>
        </div>
        <p style="margin:0;color:#6b7280;font-size:13px;">
          Timestamp: ${new Date().toISOString()}
        </p>
      `);

      await emailSvc.sendNotification(
        process.env.SUPER_ADMIN_EMAIL,
        `Security Alert — Account Lockout for ${user.first_name} ${user.last_name}`,
        adminHtml
      );
    }
  } catch (err) {
    logger.error('[auth] Failed to send lockout notification:', { message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------
function hashField(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export async function getSessions(userId) {
  const { rows } = await pool.query(
    `SELECT id, ip_hash, user_agent_hash, created_at, expires_at
     FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function revokeSession(sessionId, userId) {
  // DB revocation is AUTHORITATIVE — the auth middleware checks
  // sessions.revoked_at, so this alone invalidates the session.
  await pool.query(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  // Redis refresh-token cleanup is BEST-EFFORT: it only shortens the lifetime
  // of an already-revoked token. If Redis is unreachable we must not fail the
  // revocation — log and move on (the DB revoke above is what matters).
  try {
    const keys = await redis.keys('refresh:*');
    for (const key of keys) {
      const val = await redis.get(key);
      if (val) {
        try {
          const { sessionId: sid } = JSON.parse(val);
          if (sid === sessionId) {
            await redis.del(key);
            break;
          }
        } catch {
          // Malformed / non-JSON refresh token value — skip it.
          // Best-effort cleanup; nothing else reads this value.
        }
      }
    }
  } catch (err) {
    logger.warn('[auth] Redis refresh-token cleanup failed (best-effort):', { message: err.message });
  }
}

export async function revokeAllOtherSessions(currentSessionId, userId) {
  // DB revocation is AUTHORITATIVE (see revokeSession).
  const { rowCount } = await pool.query(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL`,
    [userId, currentSessionId]
  );

  // Redis refresh-token cleanup is BEST-EFFORT — see revokeSession.
  try {
    const keys = await redis.keys('refresh:*');
    const toDelete = [];
    for (const key of keys) {
      const val = await redis.get(key);
      if (val) {
        try {
          const { sessionId: sid } = JSON.parse(val);
          if (sid !== currentSessionId) toDelete.push(key);
        } catch {
          // Malformed / non-JSON refresh token value — skip it.
          // Best-effort cleanup; nothing else reads this value.
        }
      }
    }
    if (toDelete.length > 0) await redis.del(...toDelete);
  } catch (err) {
    logger.warn('[auth] Redis refresh-token cleanup failed (best-effort):', { message: err.message });
  }

  return rowCount ?? 0;
}

export { PUBLIC_KEY };

// ---------------------------------------------------------------------------
// 2FA — Redis key helpers
// ---------------------------------------------------------------------------
const twoFaOtpKey    = (userId) => `2fa_otp:${userId}`;
const twoFaPendingKey = (userId) => `2fa_pending:${userId}`;
const TWOFA_OTP_TTL  = 10 * 60; // 10 minutes
const TWOFA_PENDING_TTL = 10 * 60; // 10 minutes — window to complete 2FA after password OK

// ---------------------------------------------------------------------------
// Get 2FA status for a user
// ---------------------------------------------------------------------------
export async function getTwoFaStatus(userId) {
  const { rows } = await pool.query(
    'SELECT twofa_enabled FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );
  if (!rows[0]) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return { enabled: rows[0].twofa_enabled };
}

// ---------------------------------------------------------------------------
// Enable 2FA — sends OTP to email, marks pending
// ---------------------------------------------------------------------------
export async function requestTwoFaEnable(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.twofa_enabled,
            pgp_sym_decrypt(decode(u.email, 'hex'), $2) AS email
     FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId, process.env.PG_CRYPTO_KEY]
  );
  const user = rows[0];
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (user.twofa_enabled) {
    const err = new Error('2FA is already enabled');
    err.status = 409;
    throw err;
  }

  const otp = generateOtp();
  await redis.setex(twoFaOtpKey(userId), TWOFA_OTP_TTL, otp);

  const { sendOTP } = await import('../../shared/services/email.service.js');
  if (user.email) await sendOTP(user.email, otp);

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`[DEV] 2FA enable OTP for ${userId}: ${otp}`);
  }
}

// ---------------------------------------------------------------------------
// Confirm 2FA enable — verify OTP then flip the flag
// ---------------------------------------------------------------------------
export async function confirmTwoFaEnable(userId, otp) {
  const stored = await redis.get(twoFaOtpKey(userId));
  if (!stored || stored !== otp) {
    const err = new Error('Invalid or expired OTP');
    err.status = 400;
    throw err;
  }
  await redis.del(twoFaOtpKey(userId));
  await pool.query(
    'UPDATE users SET twofa_enabled = TRUE, updated_at = NOW() WHERE id = $1',
    [userId]
  );
}

// ---------------------------------------------------------------------------
// Disable 2FA — verify OTP then clear the flag
// ---------------------------------------------------------------------------
export async function requestTwoFaDisable(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.twofa_enabled,
            pgp_sym_decrypt(decode(u.email, 'hex'), $2) AS email
     FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId, process.env.PG_CRYPTO_KEY]
  );
  const user = rows[0];
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (!user.twofa_enabled) {
    const err = new Error('2FA is not enabled');
    err.status = 409;
    throw err;
  }

  const otp = generateOtp();
  await redis.setex(twoFaOtpKey(userId), TWOFA_OTP_TTL, otp);

  const { sendOTP } = await import('../../shared/services/email.service.js');
  if (user.email) await sendOTP(user.email, otp);

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`[DEV] 2FA disable OTP for ${userId}: ${otp}`);
  }
}

export async function confirmTwoFaDisable(userId, otp) {
  const stored = await redis.get(twoFaOtpKey(userId));
  if (!stored || stored !== otp) {
    const err = new Error('Invalid or expired OTP');
    err.status = 400;
    throw err;
  }
  await redis.del(twoFaOtpKey(userId));
  await pool.query(
    'UPDATE users SET twofa_enabled = FALSE, updated_at = NOW() WHERE id = $1',
    [userId]
  );
}

// ---------------------------------------------------------------------------
// Login 2FA — verify OTP sent during login, then issue tokens
// ---------------------------------------------------------------------------
export async function verifyTwoFaLogin(userId, otp, ip, userAgent) {
  // Check the pending marker (ensures this is a real in-progress login)
  const pending = await redis.get(twoFaPendingKey(userId));
  if (!pending) {
    const err = new Error('No pending 2FA session — please log in again');
    err.status = 400;
    throw err;
  }

  const stored = await redis.get(twoFaOtpKey(userId));
  if (!stored || stored !== otp) {
    const err = new Error('Invalid or expired OTP');
    err.status = 400;
    throw err;
  }

  await redis.del(twoFaOtpKey(userId));
  await redis.del(twoFaPendingKey(userId));

  // Fetch user to issue tokens
  const { rows } = await pool.query(
    `SELECT u.id, u.is_active, u.first_name, u.last_name, u.department_id,
            array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    const err = new Error('User not found or inactive');
    err.status = 401;
    throw err;
  }

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);

  const ipHash    = hashField(ip);
  const uaHash    = hashField(userAgent);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);
  const { rows: ses } = await pool.query(
    `INSERT INTO sessions (user_id, ip_hash, user_agent_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, ipHash, uaHash, expiresAt]
  );
  const sessionId = ses[0].id;

  const tokens = await issueTokenPair(user, sessionId);
  logger.info('TWOFA_VERIFY_SUCCESS', { event: 'TWOFA_VERIFY_SUCCESS', userId, ip });
  return { user: sanitizeUser(user), ...tokens };
}

// ---------------------------------------------------------------------------
// Internal: send 2FA OTP during login and store pending marker
// ---------------------------------------------------------------------------
export async function sendTwoFaLoginOtp(userId, email) {
  const otp = generateOtp();
  await redis.setex(twoFaOtpKey(userId), TWOFA_OTP_TTL, otp);
  await redis.setex(twoFaPendingKey(userId), TWOFA_PENDING_TTL, '1');

  const { sendOTP } = await import('../../shared/services/email.service.js');
  if (email) await sendOTP(email, otp);

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`[DEV] 2FA login OTP for ${userId}: ${otp}`);
  }
}
