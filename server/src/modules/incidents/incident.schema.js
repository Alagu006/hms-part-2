import { z } from 'zod';

const uuid = z.string().uuid();

export const createIncidentSchema = z.object({
  body: z.object({
    type        : z.enum(['NEAR_MISS','ADVERSE_EVENT','EQUIPMENT_FAILURE','SECURITY_BREACH']),
    severity    : z.number().int().min(1).max(5),
    description : z.string().min(1).max(5000),
    patientId   : uuid.optional().nullable(),
    witnessIds  : z.array(uuid).max(20).default([]),
  }),
});

export const incidentQuerySchema = z.object({
  query: z.object({
    type     : z.enum(['NEAR_MISS','ADVERSE_EVENT','EQUIPMENT_FAILURE','SECURITY_BREACH']).optional(),
    severity : z.coerce.number().int().min(1).max(5).optional(),
    status   : z.enum(['OPEN','UNDER_REVIEW','RESOLVED','CLOSED']).optional(),
    page     : z.coerce.number().int().min(1).default(1),
    limit    : z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const incidentParamSchema = z.object({
  params: z.object({ id: uuid }),
});
