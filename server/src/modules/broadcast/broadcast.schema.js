import { z } from 'zod';

export const createBroadcastSchema = z.object({
  body: z.object({
    title   : z.string().min(1).max(200),
    message : z.string().min(1).max(5000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    expiresAt: z.string().datetime().optional(),
  }),
});

export const listBroadcastsSchema = z.object({
  query: z.object({
    page    : z.coerce.number().int().min(1).default(1),
    limit   : z.coerce.number().int().min(1).max(50).default(20),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  }),
});

export const receiptsSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query : z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});
