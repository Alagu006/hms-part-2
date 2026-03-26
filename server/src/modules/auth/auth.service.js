import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import { pool } from '../../shared/db/pool.js';
import { redis } from '../../shared/db/redis.js';

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
  // 6-digit numeric OTP
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function getUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT u.id, u.password_hash, u.is_active, u.must_change_password,
            u.first_name, u.last_name, u.department_id, u.email,
            array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.employee_id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [username]
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
export async function login(username, password, ip) {
  // Rate limit check
  const attemptKey = loginKey(ip, username);
  const attempts   = await redis.incr(attemptKey);
  if (attempts === 1) await redis.expire(attemptKey, LOGIN_WINDOW);
  if (attempts > MAX_LOGIN_ATTEMPTS) {
    const ttl = await redis.ttl(attemptKey);
    const err  = new Error(`Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`);
    err.status = 429;
    throw err;
  }

  const user = await getUserByUsername(username);
  if (!user) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  if (!user.is_active) {
    const err = new Error('Account is disabled');
    err.status = 403;
    throw err;
  }

  // Clear rate limit on success
  await redis.del(attemptKey);

  // First-login flag
  if (user.must_change_password) {
    return { mustChangePassword: true };
  }

  // Update last_login_at
  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  const tokens = await issueTokenPair(user);
  return { user: sanitizeUser(user), ...tokens };
}

// ---------------------------------------------------------------------------
// Issue access + refresh token pair
// ---------------------------------------------------------------------------
export async function issueTokenPair(user) {
  const payload = {
    sub:          user.id,
    roles:        user.roles ?? [],
    departmentId: user.department_id,
    firstName:    user.first_name,
    lastName:     user.last_name,
  };

  const accessToken = jwt.sign(payload, PRIVATE_KEY, {
    algorithm : 'RS256',
    expiresIn : ACCESS_TOKEN_TTL,
    issuer    : process.env.JWT_ISSUER || 'hms',
    audience  : process.env.JWT_AUDIENCE || 'hms-client',
  });

  const refreshToken = generateOpaqueToken();

  // Store refresh token in Redis: value = userId, TTL = 7 days
  await redis.setex(refreshKey(refreshToken), REFRESH_TOKEN_TTL, user.id);

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

  const userId = await redis.get(refreshKey(oldRefreshToken));
  if (!userId) {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }

  // Rotate: delete old token immediately (single-use)
  await redis.del(refreshKey(oldRefreshToken));

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

  return issueTokenPair(user);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
export async function logout(refreshToken) {
  if (refreshToken) {
    await redis.del(refreshKey(refreshToken));
  }
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
    console.log(`[DEV] OTP for ${user.id}: ${otp}`);
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
  console.log(`[cron] Flushed ${keys.length} refresh tokens`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sanitizeUser(user) {
  return {
    id          : user.id,
    firstName   : user.first_name,
    lastName    : user.last_name,
    roles       : user.roles ?? [],
    departmentId: user.department_id,
  };
}

export { PUBLIC_KEY };
