import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

export const listDepartmentsSchema = z.object({
  query: z.object({
    search  : z.string().max(100).optional(),
    isActive: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
    page    : z.coerce.number().int().min(1).default(1),
    limit   : z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const createDepartmentSchema = z.object({
  body: z.object({
    name               : z.string().min(1).max(200),
    code               : z.string().min(1).max(50),
    headOfDepartmentId : uuid.optional(),
    floor              : z.string().max(20).optional(),
  }),
});

export const updateDepartmentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name               : z.string().min(1).max(200).optional(),
    headOfDepartmentId : uuid.nullable().optional(),
    floor              : z.string().max(20).optional(),
    isActive           : z.boolean().optional(),
  }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' }),
});
