import { Router } from 'express';
import { validate }             from '../../shared/middleware/validate.js';
import { authRateLimiter, otpRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { authenticate }         from '../../shared/middleware/auth.js';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  requestOtpSchema,
  changePasswordSchema,
  twoFaVerifySchema,
  twoFaDisableSchema,
} from './auth.schema.js';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  requestOtpHandler,
  changePasswordHandler,
  twoFaVerifyHandler,
  twoFaStatusHandler,
  twoFaEnableRequestHandler,
  twoFaEnableConfirmHandler,
  twoFaDisableRequestHandler,
  twoFaDisableConfirmHandler,
} from './auth.controller.js';
import { getSessions, revokeSession, revokeAllOtherSessions } from './auth.service.js';
import { query } from '../../shared/db/pool.js';

const router = Router();

router.post('/login',           authRateLimiter, validate(loginSchema),         loginHandler);
router.post('/refresh',         authRateLimiter, validate(refreshSchema),        refreshHandler);
router.post('/logout',          authRateLimiter, validate(logoutSchema),         logoutHandler);
router.post('/otp/request',     otpRateLimiter,  validate(requestOtpSchema),     requestOtpHandler);
router.post('/change-password', otpRateLimiter,  validate(changePasswordSchema), changePasswordHandler);

// ---------------------------------------------------------------------------
// 2FA routes
// ---------------------------------------------------------------------------
// Public — called during login before a token is issued
router.post('/2fa/verify', otpRateLimiter, validate(twoFaVerifySchema), twoFaVerifyHandler);

// Authenticated — manage 2FA from the user's profile/settings
router.get ('/2fa/status',          authenticate, twoFaStatusHandler);
router.post('/2fa/enable/request',  authenticate, otpRateLimiter, twoFaEnableRequestHandler);
router.post('/2fa/enable/confirm',  authenticate, otpRateLimiter, validate(twoFaDisableSchema), twoFaEnableConfirmHandler);
router.post('/2fa/disable/request', authenticate, otpRateLimiter, twoFaDisableRequestHandler);
router.post('/2fa/disable/confirm', authenticate, otpRateLimiter, validate(twoFaDisableSchema), twoFaDisableConfirmHandler);

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.is_active,
              u.last_login_at, u.created_at, u.gender, u.date_of_birth,
              u.profile_image_file_id,
              pgp_sym_decrypt(decode(u.email, 'hex'), $2) AS email,
              pgp_sym_decrypt(decode(u.phone, 'hex'), $2) AS phone,
              d.name AS department_name,
              array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles,
              pat.mrn
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN patients pat ON pat.user_id = u.id AND pat.deleted_at IS NULL
       WHERE u.id = $1 AND u.deleted_at IS NULL
       GROUP BY u.id, d.name, pat.mrn`,
      [req.user.id, process.env.PG_CRYPTO_KEY]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    return res.json({ data: {
      id                 : u.id,
      employeeId         : u.employee_id,
      mrn                : u.mrn ?? undefined,
      firstName          : u.first_name,
      lastName           : u.last_name,
      email              : u.email,
      phone              : u.phone,
      gender             : u.gender,
      dateOfBirth        : u.date_of_birth,
      departmentName     : u.department_name,
      roles              : u.roles ?? [],
      isActive           : u.is_active,
      lastLoginAt        : u.last_login_at,
      createdAt          : u.created_at,
      profileImageFileId : u.profile_image_file_id ?? null,
    }});
  } catch (err) { next(err); }
});

router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const sessions = await getSessions(req.user.id);
    const formatted = sessions.map(s => ({
      id        : s.id,
      ip        : `IP: \u2022\u2022\u2022\u2022\u2022\u2022${s.ip_hash}`,
      device    : s.user_agent_hash.includes('Mozilla')
                    ? (s.user_agent_hash.includes('Mobile') ? 'Mobile' : 'Browser')
                    : 'Unknown device',
      createdAt : s.created_at,
      expiresAt : s.expires_at,
    }));
    return res.json(formatted);
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions/:id', authenticate, async (req, res, next) => {
  try {
    await revokeSession(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions', authenticate, async (req, res, next) => {
  try {
    const currentSessionId = req.user.sessionId;
    if (!currentSessionId) {
      return res.status(400).json({ error: 'No session ID in token' });
    }
    const revokedCount = await revokeAllOtherSessions(currentSessionId, req.user.id);
    return res.json({ revokedCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/image', authenticate, async (req, res, next) => {
  try {
    const { profileImageFileId } = req.body;
    if (!profileImageFileId) return res.status(422).json({ error: 'profileImageFileId is required' });

    // Verify the file exists and is a profile image type
    const { rows: fileRows } = await query(
      `SELECT id FROM files WHERE id = $1 AND entity_type = 'USER_PROFILE' AND is_deleted = FALSE`,
      [profileImageFileId]
    );
    if (!fileRows[0]) return res.status(403).json({ error: 'File not found or access denied' });

    await query(
      `UPDATE users SET profile_image_file_id = $1, updated_at = NOW() WHERE id = $2`,
      [profileImageFileId, req.user.id]
    );
    return res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
