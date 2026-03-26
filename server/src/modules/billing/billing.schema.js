import { z } from 'zod';

const billItemSchema = z.object({
  description : z.string().min(1),
  category    : z.enum(['CONSULTATION','PROCEDURE','MEDICINE','LAB','ROOM','EQUIPMENT','OTHER']),
  quantity    : z.number().positive(),
  unitPrice   : z.number().nonnegative(),
  discount    : z.number().min(0).max(100).default(0),
});

export const createBillSchema = z.object({
  body: z.object({
    patientId   : z.string().uuid(),
    items       : z.array(billItemSchema).min(1),
    taxPercent  : z.number().min(0).max(100).default(0),
    notes       : z.string().optional(),
    dueDate     : z.string().optional(),
  }),
});

export const billsQuerySchema = z.object({
  params: z.object({ patientId: z.string().uuid() }),
});

export const payBillSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    amount        : z.number().positive(),
    paymentMethod : z.enum(['CASH','ONLINE','INSURANCE']),
    referenceNo   : z.string().optional(),
    razorpayOrderId   : z.string().optional(),
    razorpayPaymentId : z.string().optional(),
  }),
});

export const refundBillSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().min(1),
    amount: z.number().positive().optional(),
  }),
});

export const insuranceClaimSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    insurancePolicyId : z.string().uuid(),
    claimAmount       : z.number().positive(),
    claimReference    : z.string().optional(),
    notes             : z.string().optional(),
  }),
});

// Insurance CRUD
export const createInsuranceSchema = z.object({
  body: z.object({
    patientId      : z.string().uuid(),
    provider       : z.string().min(1),
    policyNumber   : z.string().min(1),
    groupNumber    : z.string().optional(),
    coverageType   : z.enum(['INDIVIDUAL','FAMILY','GROUP']).default('INDIVIDUAL'),
    coverageAmount : z.number().positive(),
    validFrom      : z.string(),
    validUntil     : z.string(),
    copayPct       : z.number().min(0).max(100).default(0),
    isPrimary      : z.boolean().default(true),
  }),
});

export const updateInsuranceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    provider       : z.string().optional(),
    policyNumber   : z.string().optional(),
    coverageAmount : z.number().positive().optional(),
    validUntil     : z.string().optional(),
    isActive       : z.boolean().optional(),
    copayPct       : z.number().min(0).max(100).optional(),
  }),
});

export const discountApprovalSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    approved: z.boolean(),
    note    : z.string().optional(),
  }),
});
