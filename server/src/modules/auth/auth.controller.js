import * as authService from './auth.service.js';
import { auditLog } from '../../shared/middleware/audit.js';
const REFRESH_COOKIE = 'hms_refresh';

const cookieOptions = {
  httpOnly : true,
  secure   : process.env.NODE_ENV === 'production',
  sameSite : 'strict',
  maxAge   : 7 * 24 * 60 * 60 * 1000, // 7 days ms
  path     : '/api/auth',
};

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
export async function loginHandler(req, res, next) {
  try {
    const { username, password } = req.body;
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'] ?? '';

    const result = await authService.login(username, password, ip, userAgent);

    if (result.mustChangePassword) {
      return res.status(200).json({ mustChangePassword: true });
    }

    if (result.requires2fa) {
      return res.status(200).json({ requires2fa: true, userId: result.userId });
    }

    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    await auditLog({
      userId   : result.user.id,
      action   : 'LOGIN',
      entity   : 'users',
      entityId : result.user.id,
      nextData : { roles: result.user.roles },
      ip,
      userAgent,
    });

    return res.status(200).json({
      accessToken : result.accessToken,
      user        : result.user,
    });
  } catch (err) {
    // Log failed login attempts
    if (err.status === 401) {
      await auditLog({
        userId   : null,
        action   : 'LOGIN_FAILED',
        entity   : 'users',
        nextData : { username: req.body?.username },
        ip       : req.ip,
        userAgent: req.headers['user-agent'] ?? '',
      }).catch(() => {}); // best-effort audit trail — must not mask the login error
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------
export async function refreshHandler(req, res, next) {
  try {
    const oldToken = req.cookies?.[REFRESH_COOKIE];
    const result   = await authService.refresh(oldToken);

    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    return res.status(200).json({ accessToken: result.accessToken });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
export async function logoutHandler(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    await authService.logout(token);

    await auditLog({
      userId   : req.user?.id ?? null,
      action   : 'LOGOUT',
      entity   : 'users',
      entityId : req.user?.id ?? null,
      ip       : req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    }).catch(() => {}); // best-effort audit trail — logout succeeds regardless

    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return res.status(200).json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/otp/request
// ---------------------------------------------------------------------------
export async function requestOtpHandler(req, res, next) {
  try {
    const { username } = req.body;
    await authService.requestOtp(username);
    // Always 200 to avoid username enumeration
    return res.status(200).json({ message: 'If the account exists, an OTP has been sent.' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/change-password
// ---------------------------------------------------------------------------
export async function changePasswordHandler(req, res, next) {
  try {
    const { username, otp, newPassword } = req.body;
    await authService.changePassword(username, otp, newPassword);

    // Invalidate any existing refresh token for this user after password change
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      await authService.logout(token);
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    }

    return res.status(200).json({ message: 'Password changed successfully. Please log in again.' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/2fa/verify  — complete login when 2FA is required
// ---------------------------------------------------------------------------
export async function twoFaVerifyHandler(req, res, next) {
  try {
    const { userId, otp } = req.body;
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'] ?? '';

    const result = await authService.verifyTwoFaLogin(userId, otp, ip, userAgent);

    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    await auditLog({
      userId   : result.user.id,
      action   : 'LOGIN_2FA',
      entity   : 'users',
      entityId : result.user.id,
      nextData : { roles: result.user.roles },
      ip,
      userAgent,
    });

    return res.status(200).json({
      accessToken: result.accessToken,
      user       : result.user,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /auth/2fa/status  — is 2FA enabled for the current user?
// ---------------------------------------------------------------------------
export async function twoFaStatusHandler(req, res, next) {
  try {
    const status = await authService.getTwoFaStatus(req.user.id);
    return res.status(200).json(status);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/2fa/enable/request  — send OTP to start enabling 2FA
// ---------------------------------------------------------------------------
export async function twoFaEnableRequestHandler(req, res, next) {
  try {
    await authService.requestTwoFaEnable(req.user.id);
    return res.status(200).json({ message: 'OTP sent to your registered email.' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/2fa/enable/confirm  — verify OTP and activate 2FA
// ---------------------------------------------------------------------------
export async function twoFaEnableConfirmHandler(req, res, next) {
  try {
    const { otp } = req.body;
    await authService.confirmTwoFaEnable(req.user.id, otp);

    await auditLog({
      userId  : req.user.id,
      action  : '2FA_ENABLED',
      entity  : 'users',
      entityId: req.user.id,
      ip      : req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    });

    return res.status(200).json({ message: '2FA has been enabled on your account.' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/2fa/disable/request  — send OTP to start disabling 2FA
// ---------------------------------------------------------------------------
export async function twoFaDisableRequestHandler(req, res, next) {
  try {
    await authService.requestTwoFaDisable(req.user.id);
    return res.status(200).json({ message: 'OTP sent to your registered email.' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/2fa/disable/confirm  — verify OTP and deactivate 2FA
// ---------------------------------------------------------------------------
export async function twoFaDisableConfirmHandler(req, res, next) {
  try {
    const { otp } = req.body;
    await authService.confirmTwoFaDisable(req.user.id, otp);

    await auditLog({
      userId  : req.user.id,
      action  : '2FA_DISABLED',
      entity  : 'users',
      entityId: req.user.id,
      ip      : req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    });

    return res.status(200).json({ message: '2FA has been disabled on your account.' });
  } catch (err) {
    next(err);
  }
}
