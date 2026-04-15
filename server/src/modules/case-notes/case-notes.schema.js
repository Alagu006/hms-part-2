import { z } from 'zod';

export const listCaseNotesSchema = z.object({
  query: z.object({
    patientId: z.string().uuid().optional(),
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const createCaseNoteSchema = z.object({
  body: z.object({
    patientId  : z.string().uuid(),
    noteType   : z.enum(['ASSESSMENT','FOLLOW_UP','REFERRAL','DISCHARGE_PLAN','OTHER']).default('ASSESSMENT'),
    content    : z.string().min(1),
    followUpDate: z.string().optional(),
  }),
});

export const updateCaseNoteSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    content     : z.string().min(1).optional(),
    followUpDate: z.string().optional().nullable(),
    resolved    : z.boolean().optional(),
  }),
});
