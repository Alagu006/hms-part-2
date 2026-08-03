import { z } from 'zod';

const periodEnum = z.enum(['7d', '30d', '90d']).default('30d');

export const patientStatsSchema = z.object({
  query: z.object({ period: periodEnum }),
});

export const financialSchema = z.object({
  query: z.object({ period: periodEnum }),
});

export const staffPerformanceSchema = z.object({
  query: z.object({ period: z.enum(['7d', '30d', '90d']).default('30d') }),
});

export const operationalSchema = z.object({
  query: z.object({ period: periodEnum }),
});

export const generateReportSchema = z.object({
  query: z.object({
    type  : z.enum(['patient', 'financial', 'staff']),
    format: z.enum(['pdf', 'csv']),
    period: periodEnum,
  }),
});

export const reportHistorySchema = z.object({
  query: z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
});

// Validate jobId param — BullMQ job IDs are numeric strings
export const reportStatusSchema = z.object({
  params: z.object({
    jobId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9:_-]+$/, 'Invalid job ID'),
  }),
});

// Validate download key param — must match safe filename pattern
export const downloadKeySchema = z.object({
  params: z.object({
    key: z.string()
      .min(1)
      .max(200)
      .regex(/^report_[a-z]+_[0-9a-z]+_\d+\.(csv|json|pdf)$/, 'Invalid download key'),
  }),
});
