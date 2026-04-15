import { z } from 'zod';

const uuid = z.string().uuid();

const frequencyEnum = z.enum(['1x', '2x', '3x', 'SOS']);

export const prescriptionItemSchema = z.object({
  medicineId  : uuid,
  medicineName: z.string().min(1).max(200),
  dosage      : z.string().min(1).max(100),
  frequency   : frequencyEnum,
  durationDays: z.number().int().min(1).max(365),
  quantity    : z.number().int().min(1),
  instructions: z.string().max(500).optional(),
});

export const createPrescriptionSchema = z.object({
  body: z.object({
    patientId     : uuid,
    diagnosisCodes: z.array(z.string().min(1).max(20)).min(1).max(20),
    notes         : z.string().max(1000).optional(),
    items         : z.array(prescriptionItemSchema).min(1).max(20),
  }),
});

export const getPrescriptionSchema = z.object({
  params: z.object({ id: uuid }),
});

export const patientHistorySchema = z.object({
  params: z.object({ patientId: uuid }),
  query : z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
});

export const myPrescriptionsSchema = z.object({
  query: z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
});

export const dispenseSchema = z.object({
  params: z.object({ id: uuid }),
  body  : z.object({
    dispensedItems: z.array(z.object({
      itemId    : uuid,
      dispensed : z.boolean(),
    })).min(1),
    notes: z.string().max(500).optional(),
  }),
});

export const medicineSearchSchema = z.object({
  query: z.object({
    q: z.string().min(3).max(100),
  }),
});

export const prescriptionCountSchema = z.object({
  query: z.object({
    status   : z.enum(['ISSUED', 'PENDING', 'DISPENSED', 'PARTIALLY_DISPENSED', 'CANCELLED']).optional(),
    patientId: uuid.optional(),
  }),
});

export const listPrescriptionsSchema = z.object({
  query: z.object({
    status : z.enum(['ISSUED', 'PENDING', 'DISPENSED', 'PARTIALLY_DISPENSED', 'CANCELLED']).optional(),
    date   : z.string().optional(),
    page   : z.coerce.number().int().min(1).default(1),
    limit  : z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const importOpenFdaSchema = z.object({
  body: z.object({
    query: z.string().min(2).max(200),
  }),
});
