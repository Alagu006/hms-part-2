import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

export const listAppointmentsSchema = z.object({
  query: z.object({
    doctorId : z.enum(['me']).optional(),
    patientId: z.enum(['me']).or(uuid).optional(),
    date     : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    status   : z.enum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
    page     : z.coerce.number().int().min(1).default(1),
    limit    : z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const getAppointmentSchema = z.object({
  params: z.object({ id: uuid }),
});

export const updateAppointmentStatusSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: z.enum(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
    notes : z.string().max(500).optional(),
  }),
});

export const createAppointmentSchema = z.object({
  body: z.object({
    patientId   : uuid,
    doctorId    : uuid,
    departmentId: uuid.optional(),
    scheduledAt : z.string().datetime(),
    durationMinutes: z.number().int().min(5).max(480).default(30),
    type        : z.enum(['IN_PERSON', 'TELEMEDICINE', 'FOLLOW_UP', 'EMERGENCY']),
    reason      : z.string().min(5, 'Please describe your reason for the visit').max(500),
  }),
});
