import { z } from 'zod';

const CATEGORIES = ['MEDICINE', 'EQUIPMENT', 'CONSUMABLE', 'LINEN', 'CHEMICAL', 'OTHER'];
const BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'RESERVED'];

export const createItemSchema = z.object({
  body: z.object({
    name            : z.string().min(1).max(200),
    sku             : z.string().min(1).max(100),
    category        : z.enum(CATEGORIES),
    departmentId    : z.string().uuid().optional(),
    unit            : z.string().min(1).max(50),
    quantityInStock : z.number().min(0).default(0),
    reorderLevel    : z.number().min(0).default(0),
    unitCost        : z.number().min(0).optional(),
    expiryDate      : z.string().date().optional().nullable(),
    supplier        : z.string().max(200).optional(),
    location        : z.string().max(200).optional(),
  }),
});

export const updateItemSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({
    name            : z.string().min(1).max(200).optional(),
    category        : z.enum(CATEGORIES).optional(),
    departmentId    : z.string().uuid().optional().nullable(),
    unit            : z.string().min(1).max(50).optional(),
    quantityInStock : z.number().min(0).optional(),
    reorderLevel    : z.number().min(0).optional(),
    unitCost        : z.number().min(0).optional().nullable(),
    expiryDate      : z.string().date().optional().nullable(),
    supplier        : z.string().max(200).optional().nullable(),
    location        : z.string().max(200).optional().nullable(),
  }),
});

export const itemIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const listItemsSchema = z.object({
  query: z.object({
    page        : z.coerce.number().int().min(1).default(1),
    limit       : z.coerce.number().int().min(1).max(100).default(20),
    category    : z.enum(CATEGORIES).optional(),
    departmentId: z.string().uuid().optional(),
    search      : z.string().max(100).optional(),
    lowStock    : z.coerce.boolean().optional(),
  }),
});

export const updateBedSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({
    status: z.enum(BED_STATUSES),
    notes : z.string().max(500).optional(),
  }),
});

export const generateQrSchema = z.object({
  body: z.object({
    itemId: z.string().uuid(),
  }),
});

export const qrCodeSchema = z.object({
  params: z.object({ code: z.string().min(1).max(200) }),
});

export const adjustQuantitySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({
    adjustment: z.number(),           // positive = add, negative = remove
    reason    : z.string().max(500).optional(),
  }),
});

const ROOM_TYPES = ['GENERAL', 'ICU', 'PRIVATE', 'SEMI_PRIVATE', 'EMERGENCY', 'OT', 'ISOLATION'];

export const createRoomSchema = z.object({
  body: z.object({
    roomNumber  : z.string().min(1).max(20),
    roomType    : z.enum(ROOM_TYPES),
    floor       : z.coerce.number().int().min(0).max(50),
    departmentId: z.string().uuid().optional().nullable(),
  }),
});

export const createBedSchema = z.object({
  params: z.object({ roomId: z.string().uuid() }),
  body  : z.object({
    bedNumber: z.string().min(1).max(20),
  }),
});
