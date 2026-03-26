import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

const idTypes = ['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE', 'OTHER'];

export const logVisitorSchema = z.object({
  body: z.object({
    patientId     : uuid,
    visitorName   : z.string().min(1).max(200),
    visitorPhone  : z.string().min(7).max(20).optional(),
    relationship  : z.string().max(100).optional(),
    idType        : z.enum(idTypes).optional(),
    idNumber      : z.string().max(100).optional(),
    purpose       : z.string().max(300).optional(),
    badgeNumber   : z.string().max(50).optional(),
  }),
});

export const visitorHistorySchema = z.object({
  params: z.object({ patientId: uuid }),
  query: z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const checkoutVisitorSchema = z.object({
  params: z.object({ id: uuid }),
});
