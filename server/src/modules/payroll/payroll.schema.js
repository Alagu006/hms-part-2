import { z } from 'zod';

export const upsertSalaryStructureSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    basicSalary   : z.number().min(0),
    hraPct        : z.number().min(0).max(100).default(0),
    transportAllow: z.number().min(0).default(0),
    medicalAllow  : z.number().min(0).default(0),
    otherAllow    : z.number().min(0).default(0),
    taxPct        : z.number().min(0).max(100).default(0),
    pfPct         : z.number().min(0).max(100).default(12),
    effectiveFrom : z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes         : z.string().optional(),
  }),
});

export const createRunSchema = z.object({
  body: z.object({
    periodYear : z.number().int().min(2000),
    periodMonth: z.number().int().min(1).max(12),
    notes      : z.string().optional(),
  }),
});

export const processRunSchema = z.object({
  params: z.object({ runId: z.string().uuid() }),
});

export const runsQuerySchema = z.object({
  query: z.object({
    year : z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  }),
});

export const runDetailsQuerySchema = z.object({
  params: z.object({ runId: z.string().uuid() }),
  query: z.object({
    hasError: z.enum(['true','false']).optional(),
    search  : z.string().optional(),
    page    : z.coerce.number().int().min(1).default(1),
    limit   : z.coerce.number().int().min(1).max(200).default(50),
  }),
});

export const salaryHistorySchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
});
