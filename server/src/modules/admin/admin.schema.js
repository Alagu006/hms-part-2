import { z } from 'zod';

export const auditLogsQuerySchema = z.object({
  query: z.object({
    userId   : z.string().uuid().optional(),
    role     : z.string().optional(),
    action   : z.string().optional(),
    entity   : z.string().optional(),
    severity : z.string().optional(),
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
    page      : z.coerce.number().int().min(1).default(1),
    limit     : z.coerce.number().int().min(1).max(200).default(50),
  }),
});

export const setStatusSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({ isActive: z.boolean() }),
});

export const sessionDeleteSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
