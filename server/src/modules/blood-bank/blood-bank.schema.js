import { z } from 'zod';

const uuid       = z.string().uuid();
const bloodGroup = z.enum(['A+','A-','B+','B-','AB+','AB-','O+','O-']);
const status     = z.enum(['AVAILABLE','RESERVED','USED','EXPIRED']);

export const createBloodUnitSchema = z.object({
  body: z.object({
    bloodGroup : bloodGroup,
    units      : z.number().int().positive(),
    donorName  : z.string().max(200).optional().nullable(),
    expiryDate : z.string().date(),
    status     : status.default('AVAILABLE'),
  }),
});

export const updateBloodUnitSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    bloodGroup : bloodGroup.optional(),
    units      : z.number().int().positive().optional(),
    donorName  : z.string().max(200).optional().nullable(),
    expiryDate : z.string().date().optional(),
    status     : status.optional(),
  }),
});

export const bloodUnitParamSchema = z.object({
  params: z.object({ id: uuid }),
});

export const requestBloodSchema = z.object({
  body: z.object({
    patientId  : uuid,
    bloodGroup : bloodGroup,
    units      : z.number().int().positive(),
    reason     : z.string().max(500).optional(),
  }),
});
