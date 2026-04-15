import { z } from 'zod';

export const auditLogsQuerySchema = z.object({
  query: z.object({
    userId   : z.string().uuid().optional(),
    role     : z.string().optional(),
    action   : z.string().optional(),
    entity   : z.string().optional(),
    severity : z.string().optional(),
    flagged  : z.enum(['true', 'false']).optional(),
    dateFrom : z.string().optional(),
    dateTo   : z.string().optional(),
    page     : z.coerce.number().int().min(1).default(1),
    limit    : z.coerce.number().int().min(1).max(200).default(50),
  }),
});

export const usersQuerySchema = z.object({
  query: z.object({
    role      : z.string().optional(),
    department: z.string().uuid().optional(),
    status    : z.enum(['active', 'inactive']).optional(),
    search    : z.string().optional(),
    page      : z.coerce.number().int().min(1).default(1),
    limit     : z.coerce.number().int().min(1).max(200).default(50),
  }),
});

export const setStatusSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({ isActive: z.boolean() }),
});

export const createUserSchema = z.object({
  body: z.object({
    firstName       : z.string().min(1),
    lastName        : z.string().min(1),
    email           : z.string().email(),
    phone           : z.string().optional(),
    role            : z.enum(['ADMIN','DOCTOR','NURSE','RECEPTIONIST','LAB_TECH','PHARMACIST',
                              'INVENTORY','RADIOLOGIST','BILLING','HR','DIETITIAN','PHYSIO',
                              'ANESTHETIST','SOCIAL_WORKER','IT_ADMIN','SECURITY_OFC','ORDERLY','PATIENT']),
    departmentId    : z.string().uuid().optional(),
    dateOfBirth     : z.string().optional(),
    gender          : z.enum(['MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY']).optional(),
    bloodGroup      : z.string().optional(),
    specialization  : z.string().optional(),
    licenseNumber   : z.string().optional(),
    shiftType       : z.string().optional(),
    address         : z.string().optional(),
    emergencyContact: z.string().optional(),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({
    firstName       : z.string().min(1).optional(),
    lastName        : z.string().min(1).optional(),
    phone           : z.string().optional(),
    departmentId    : z.string().uuid().optional().nullable(),
    dateOfBirth     : z.string().optional().nullable(),
    gender          : z.enum(['MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY']).optional().nullable(),
    bloodGroup      : z.string().optional().nullable(),
    specialization  : z.string().optional().nullable(),
    licenseNumber   : z.string().optional().nullable(),
    shiftType       : z.string().optional().nullable(),
    address         : z.string().optional().nullable(),
    emergencyContact: z.string().optional().nullable(),
    profileImageFileId: z.string().uuid().optional().nullable(),
  }),
});

export const sessionDeleteSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const flagAuditLogSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({ reason: z.string().max(500).optional() }),
});

export const blockIpSchema = z.object({
  body: z.object({
    ipAddress: z.string().min(1).max(45),
    reason   : z.string().max(500).optional(),
    expiresAt: z.string().optional(),
  }),
});

export const unblockIpSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});
