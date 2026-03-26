import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const listHandoverSchema = z.object({
  query: z.object({
    toNurseId  : uuid.optional(),
    toShiftType: z.enum(['MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT']).optional(),
    unreadOnly : z.enum(['true','false']).transform(v => v === 'true').optional(),
    patientId  : uuid.optional(),
    page       : z.coerce.number().int().min(1).default(1),
    limit      : z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const createHandoverSchema = z.object({
  body: z.object({
    toNurseId  : uuid.optional(),
    toShiftType: z.enum(['MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT']).optional(),
    patientId  : uuid,
    priority   : priorityEnum.default('NORMAL'),
    note       : z.string().min(1).max(2000),
  }),
});

export const markReadSchema = z.object({
  params: z.object({ id: uuid }),
});
