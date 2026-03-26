import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

export const listDoctorsSchema = z.object({
  query: z.object({
    departmentId: uuid.optional(),
    search      : z.string().max(100).optional(),
    page        : z.coerce.number().int().min(1).default(1),
    limit       : z.coerce.number().int().min(1).max(100).default(50),
  }),
});
