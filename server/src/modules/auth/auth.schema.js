import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(1).max(256),
  }),
});

export const refreshSchema = z.object({
  // refresh token comes via HttpOnly cookie — no body fields required
  body: z.object({}).optional(),
});

export const logoutSchema = z.object({
  body: z.object({}).optional(),
});

export const requestOtpSchema = z.object({
  body: z.object({
    username: z.string().min(1).max(100),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    username: z.string().min(1).max(100),
    otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .max(256)
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/[0-9]/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
    confirmPassword: z.string(),
  }).refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

// ---------------------------------------------------------------------------
// 2FA schemas
// ---------------------------------------------------------------------------
export const twoFaVerifySchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    otp   : z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  }),
});

export const twoFaDisableSchema = z.object({
  body: z.object({
    otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  }),
});
