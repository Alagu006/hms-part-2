import * as authService from './auth.service.js';

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
    const ip = req.ip;

    const result = await authService.login(username, password, ip);

    if (result.mustChangePassword) {
      return res.status(200).json({ mustChangePassword: true });
    }

    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    return res.status(200).json({
      accessToken : result.accessToken,
      user        : result.user,
    });
  } catch (err) {
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
