import { z } from 'zod';

export const listDietPlansSchema = z.object({
  query: z.object({
    patientId: z.string().uuid().optional(),
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const createDietPlanSchema = z.object({
  body: z.object({
    patientId   : z.string().uuid(),
    planName    : z.string().min(1),
    calories    : z.number().int().positive().optional(),
    protein     : z.string().optional(),
    carbs       : z.string().optional(),
    fats        : z.string().optional(),
    restrictions: z.string().optional(),
    notes       : z.string().optional(),
    startDate   : z.string().optional(),
    endDate     : z.string().optional(),
  }),
});

export const updateDietPlanSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    planName    : z.string().min(1).optional(),
    calories    : z.number().int().positive().optional().nullable(),
    protein     : z.string().optional().nullable(),
    carbs       : z.string().optional().nullable(),
    fats        : z.string().optional().nullable(),
    restrictions: z.string().optional().nullable(),
    notes       : z.string().optional().nullable(),
    startDate   : z.string().optional().nullable(),
    endDate     : z.string().optional().nullable(),
    isActive    : z.boolean().optional(),
  }),
});
