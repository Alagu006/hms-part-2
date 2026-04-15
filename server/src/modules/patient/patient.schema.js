import { z } from 'zod';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidV4Regex, 'Invalid UUID');

export const lookupPatientByMrnSchema = z.object({
  query: z.object({ mrn: z.string().min(1).max(50) }),
});

export const createPatientSchema = z.object({
  body: z.object({
    firstName       : z.string().min(1).max(100),
    lastName        : z.string().min(1).max(100),
    dateOfBirth     : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    gender          : z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
    bloodGroup      : z.enum(['A+','A-','B+','B-','AB+','AB-','O+','O-','UNKNOWN']).optional(),
    email           : z.string().email().max(255),
    phone           : z.string().min(7).max(20),
    address         : z.string().max(500).optional(),
    emergencyContact: z.string().max(200).optional(),
  }),
});

export const updatePatientSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    firstName       : z.string().min(1).max(100).optional(),
    lastName        : z.string().min(1).max(100).optional(),
    dateOfBirth     : z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    gender          : z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
    bloodGroup      : z.enum(['A+','A-','B+','B-','AB+','AB-','O+','O-','UNKNOWN']).optional(),
    email           : z.string().email().max(255).optional(),
    phone           : z.string().min(7).max(20).optional(),
    address         : z.string().max(500).optional(),
    emergencyContact: z.string().max(200).optional(),
  }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' }),
});

export const getPatientSchema = z.object({
  params: z.object({ id: uuid }),
});

export const listPatientsSchema = z.object({
  query: z.object({
    status      : z.enum(['inpatient', 'outpatient']).optional(),
    departmentId: uuid.optional(),
    ward        : z.string().max(100).optional(),
    search      : z.string().max(100).optional(),
    doctorId    : z.enum(['me']).optional(),
    page        : z.coerce.number().int().min(1).default(1),
    limit       : z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const timelineSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
});

export const getMedicalRecordSchema = z.object({
  params: z.object({ id: uuid }),
});
