import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

export const createLabOrderSchema = z.object({
  body: z.object({
    patientId  : uuid,
    testName   : z.string().min(1).max(200),
    testCode   : z.string().max(50).optional(),
    priority   : z.enum(['STAT', 'URGENT', 'ROUTINE']).default('ROUTINE'),
    notes      : z.string().max(500).optional(),
  }),
});

export const getPatientLabResultsSchema = z.object({
  params: z.object({ patientId: uuid }),
  query : z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const getLabResultSchema = z.object({
  params: z.object({ id: uuid }),
});

export const listLabOrdersSchema = z.object({
  query: z.object({
    status   : z.enum(['PENDING', 'COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED']).optional(),
    priority : z.enum(['STAT', 'URGENT', 'ROUTINE']).optional(),
    date     : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    patientId: uuid.optional(),
    page      : z.coerce.number().int().min(1).default(1),
    limit     : z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const updateLabOrderSchema = z.object({
  params: z.object({ id: uuid }),
  body  : z.object({
    status      : z.enum(['PENDING', 'COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED']).optional(),
    assignedTo  : uuid.nullable().optional(),
    notes       : z.string().max(500).optional(),
  }).refine(obj => Object.keys(obj).length > 0, {
    message: 'At least one field required',
  }),
});

export const createLabResultSchema = z.object({
  body: z.object({
    labOrderId      : uuid,
    resultData      : z.string().min(1).max(10000).optional(),
    resultText      : z.string().min(1).max(5000).optional(),
    interpretation  : z.string().max(2000).optional(),
    isAbnormal      : z.boolean().default(false),
    referenceRange  : z.string().max(500).optional(),
    fileId          : uuid.optional(),
    fileKey         : z.string().optional(),
    fileIv          : z.string().optional(),
  }),
});
