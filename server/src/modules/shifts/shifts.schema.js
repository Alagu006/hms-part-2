import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

const shiftTypes = ['MORNING', 'AFTERNOON', 'NIGHT', 'ON_CALL', 'SPLIT'];

export const listShiftsSchema = z.object({
  query: z.object({
    userId      : uuid.optional(),
    departmentId: uuid.optional(),
    shiftDate   : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    shiftType   : z.enum(shiftTypes).optional(),
    page        : z.coerce.number().int().min(1).default(1),
    limit       : z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const createShiftSchema = z.object({
  body: z.object({
    userId      : uuid,
    departmentId: uuid.optional(),
    shiftType   : z.enum(shiftTypes),
    shiftDate   : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    startTime   : z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be HH:MM or HH:MM:SS'),
    endTime     : z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be HH:MM or HH:MM:SS'),
    notes       : z.string().max(500).optional(),
  }),
});

export const deleteShiftSchema = z.object({
  params: z.object({ id: uuid }),
});
