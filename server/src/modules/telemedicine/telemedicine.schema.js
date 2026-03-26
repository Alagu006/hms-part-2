import { z } from 'zod';

export const createSessionSchema = z.object({
  body: z.object({
    patientId      : z.string().uuid(),
    doctorId       : z.string().uuid(),
    scheduledAt    : z.string().datetime(),
    durationMinutes: z.number().int().min(5).max(120).default(30),
  }),
});

export const sessionIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const endSessionSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({
    consultationNote: z.string().max(5000).optional(),
  }),
});

export const listSessionsSchema = z.object({
  query: z.object({
    page  : z.coerce.number().int().min(1).default(1),
    limit : z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED']).optional(),
  }),
});
