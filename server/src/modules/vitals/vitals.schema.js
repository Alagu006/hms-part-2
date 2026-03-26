import { z } from 'zod';

const uuid = z.string().uuid();

export const recordVitalsSchema = z.object({
  body: z.object({
    patientId      : uuid,
    medicalRecordId: uuid.optional(),
    temperature    : z.number().min(30).max(45).optional(),
    pulseBpm       : z.number().int().min(20).max(300).optional(),
    bpSystolic     : z.number().int().min(50).max(300).optional(),
    bpDiastolic    : z.number().int().min(20).max(200).optional(),
    spo2           : z.number().min(50).max(100).optional(),
    weightKg       : z.number().min(0.5).max(500).optional(),
    bloodGlucose   : z.number().min(1).max(100).optional(),  // mmol/L
    respiratoryRate: z.number().int().min(1).max(100).optional(),
    notes          : z.string().max(500).optional(),
  }).refine(
    (d) => [
      d.temperature, d.pulseBpm, d.bpSystolic,
      d.spo2, d.weightKg, d.bloodGlucose, d.respiratoryRate,
    ].some((v) => v !== undefined),
    { message: 'At least one vital sign must be provided' }
  ),
});

export const vitalsHistorySchema = z.object({
  params: z.object({ patientId: uuid }),
  query : z.object({
    days : z.coerce.number().int().min(1).max(90).default(7),
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const vitalsCountSchema = z.object({
  query: z.object({
    nurseId: z.enum(['me']).optional(),
    date   : z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
});
