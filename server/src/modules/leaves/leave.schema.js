import { z } from 'zod';

const LEAVE_TYPES = ['ANNUAL','SICK','MATERNITY','PATERNITY','UNPAID','EMERGENCY','COMPENSATORY'];

export const applyLeaveSchema = z.object({
  body: z.object({
    leaveType : z.enum(LEAVE_TYPES),
    startDate : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
    endDate   : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
    reason    : z.string().max(1000).optional(),
  }),
});

export const reviewLeaveSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({ reviewNote: z.string().max(500).optional() }),
});

export const allLeavesQuerySchema = z.object({
  query: z.object({
    role      : z.string().optional(),
    department: z.string().uuid().optional(),
    status    : z.enum(['PENDING','APPROVED','REJECTED','CANCELLED']).optional(),
    dateFrom  : z.string().optional(),
    dateTo    : z.string().optional(),
    page      : z.coerce.number().int().min(1).default(1),
    limit     : z.coerce.number().int().min(1).max(200).default(50),
  }),
});

export const calendarQuerySchema = z.object({
  query: z.object({
    month     : z.coerce.number().int().min(1).max(12).default(() => new Date().getMonth() + 1),
    year      : z.coerce.number().int().min(2000).default(() => new Date().getFullYear()),
    department: z.string().uuid().optional(),
  }),
});

export const balancesParamsSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
});
