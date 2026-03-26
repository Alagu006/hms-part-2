import { Router } from 'express';
import { validate }             from '../../shared/middleware/validate.js';
import { authRateLimiter }      from '../../shared/middleware/rateLimiter.js';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  requestOtpSchema,
  changePasswordSchema,
} from './auth.schema.js';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  requestOtpHandler,
  changePasswordHandler,
} from './auth.controller.js';

const router = Router();

// All auth routes get rate-limited at the router level
router.use(authRateLimiter);

router.post('/login',           validate(loginSchema),         loginHandler);
router.post('/refresh',         validate(refreshSchema),        refreshHandler);
router.post('/logout',          validate(logoutSchema),         logoutHandler);
router.post('/otp/request',     validate(requestOtpSchema),     requestOtpHandler);
router.post('/change-password', validate(changePasswordSchema), changePasswordHandler);

export default router;
