import { z } from 'zod';

const uuid = z.string().uuid();

export const createDischargeSummarySchema = z.object({
  body: z.object({
    patientId          : uuid,
    admissionDate      : z.string().datetime(),
    dischargeDate      : z.string().datetime(),
    diagnosis          : z.string().min(1).max(2000),
    treatmentSummary   : z.string().max(5000).optional(),
    dischargeMedications: z.string().max(3000).optional(),
    followUpDate       : z.string().date().optional().nullable(),
    instructions       : z.string().max(3000).optional(),
  }),
});

export const getPatientDischargeSummariesSchema = z.object({
  params: z.object({ patientId: uuid }),
});
