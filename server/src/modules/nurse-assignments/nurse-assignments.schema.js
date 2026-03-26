import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

export const getMyAssignmentsSchema = z.object({
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
});
