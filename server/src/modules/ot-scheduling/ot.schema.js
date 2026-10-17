import { z } from 'zod';

const uuid    = z.string().uuid();
const theatre = z.enum(['OT-1','OT-2','OT-3']);
const status  = z.enum(['SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','POSTPONED']);

export const createOTScheduleSchema = z.object({
  body: z.object({
    patientId       : uuid,
    doctorId        : uuid,
    anesthetistId   : uuid.optional().nullable(),
    theatre         : theatre,
    scheduledAt     : z.string().datetime(),
    durationMinutes : z.number().int().positive().max(720),
    procedure       : z.string().min(1).max(500),
    status          : status.default('SCHEDULED'),
    notes           : z.string().max(2000).optional().nullable(),
  }),
});

export const updateOTScheduleSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    patientId       : uuid.optional(),
    doctorId        : uuid.optional(),
    anesthetistId   : uuid.optional().nullable(),
    theatre         : theatre.optional(),
    scheduledAt     : z.string().datetime().optional(),
    durationMinutes : z.number().int().positive().max(720).optional(),
    procedure       : z.string().min(1).max(500).optional(),
    status          : status.optional(),
    notes           : z.string().max(2000).optional().nullable(),
  }),
});

export const otParamSchema = z.object({
  params: z.object({ id: uuid }),
});

export const otQuerySchema = z.object({
  query: z.object({
    date    : z.string().date().optional(),
    theatre : theatre.optional(),
    status  : status.optional(),
  }),
});
