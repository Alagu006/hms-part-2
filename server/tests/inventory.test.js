// Coverage for the inventory module: item CRUD, quantity adjustments with
// low-stock alerts, QR code signing/verification, bed matrix/status, CSV bulk
// import, alerts/stats, and room/bed creation.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, auditMock, createNotifMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  auditMock: vi.fn(),
  createNotifMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : { LOW_STOCK: 'ALERT' },
}));

import * as inv from '../src/modules/inventory/inventory.service.js';

const QR_SECRET = 'change-me-qr-secret';

function makeQrCode(itemId) {
  const sig = crypto.createHmac('sha256', QR_SECRET).update(itemId).digest('hex').slice(0, 12);
  return `INV-${itemId.replace(/-/g, '')}-${sig}`;
}

function itemRow(overrides = {}) {
  return {
    id: 'i1', name: 'Aspirin', sku: 'SKU-1', category: 'MEDICINE',
    department_id: 'dep1', unit: 'tab', quantity_in_stock: 100,
    reorder_level: 20, unit_cost: 5.5, expiry_date: null,
    supplier: null, location: 'Shelf A', total_count: '1', ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockImplementation(async () => {});
  createNotifMock.mockImplementation(async () => ({}));
});

// ---------------------------------------------------------------------------
// createItem
// ---------------------------------------------------------------------------
describe('inventory.service — createItem', () => {
  it('inserts with defaults and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1' }] });
    const res = await inv.createItem(
      { name: 'Aspirin', sku: 'S1', category: 'MEDICINE', unit: 'tab', quantityInStock: 10, reorderLevel: 5 },
      'u1', 'ip', 'ua'
    );
    expect(res.id).toBe('i1');
    expect(q.mock.calls[0][1]).toEqual(['Aspirin', 'S1', 'MEDICINE', null, 'tab', 10, 5, null, null, null, null]);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', entity: 'inventory_items', entityId: 'i1',
      nextData: expect.objectContaining({ name: 'Aspirin' }),
    }));
  });
});

// ---------------------------------------------------------------------------
// listItems / getItemById
// ---------------------------------------------------------------------------
describe('inventory.service — listItems', () => {
  it('lists with no filters and strips total_count', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    const res = await inv.listItems({ page: 1, limit: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0]).not.toHaveProperty('total_count');
    expect(q.mock.calls[0][1]).toEqual([20, 0]);
  });

  it('builds filters for category, department, search, and low stock', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await inv.listItems({ category: 'MEDICINE', departmentId: 'dep1', search: 'asp', lowStock: true, page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('i.category = $1');
    expect(sql).toContain('i.department_id = $2');
    expect(sql).toContain('(i.name ILIKE $3 OR i.sku ILIKE $3)');
    expect(sql).toContain('i.quantity_in_stock <= i.reorder_level');
    expect(params).toEqual(['MEDICINE', 'dep1', '%asp%', 10, 10]);
  });
});

describe('inventory.service — getItemById', () => {
  it('returns the row or null', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    expect(await inv.getItemById('i1')).toMatchObject({ id: 'i1' });
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.getItemById('i1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateItem / deleteItem
// ---------------------------------------------------------------------------
describe('inventory.service — updateItem', () => {
  it('returns null when the item is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.updateItem('i1', { name: 'X' }, 'u1', 'ip', 'ua')).toBeNull();
  });

  it('returns the existing item unchanged when nothing changed', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    const res = await inv.updateItem('i1', {}, 'u1', 'ip', 'ua');
    expect(res).toMatchObject({ id: 'i1' });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('updates only provided fields and audits with previous data', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    q.mockResolvedValueOnce({ rows: [itemRow({ name: 'New' })] });

    const res = await inv.updateItem('i1', { name: 'New', unitCost: 9.9 }, 'u1', 'ip', 'ua');
    expect(res.name).toBe('New');
    const [sql, params] = q.mock.calls[1];
    expect(sql).toContain('SET name = $1, unit_cost = $2');
    expect(params).toEqual(['New', 9.9, 'i1']);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', prevData: expect.objectContaining({ id: 'i1' }),
    }));
  });
});

describe('inventory.service — deleteItem', () => {
  it('returns null when no row matched', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.deleteItem('i1', 'u1', 'ip', 'ua')).toBeNull();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('soft-deletes and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1' }] });
    const res = await inv.deleteItem('i1', 'u1', 'ip', 'ua');
    expect(res.id).toBe('i1');
    expect(q.mock.calls[0][0]).toContain('deleted_at = NOW()');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', entityId: 'i1' }));
  });
});

// ---------------------------------------------------------------------------
// adjustQuantity — low-stock alerts
// ---------------------------------------------------------------------------
describe('inventory.service — adjustQuantity', () => {
  it('returns null when the item is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.adjustQuantity('i1', -5, 'usage', 'u1', 'ip', 'ua')).toBeNull();
  });

  it('audits with previous/next quantities', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', name: 'A', sku: 'S', unit: 'tab', quantity_in_stock: 5, reorder_level: 20 }] });
    await inv.adjustQuantity('i1', -5, 'usage', 'u1', 'ip', 'ua');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ADJUST_QUANTITY',
      prevData: { quantity_in_stock: 10 },
      nextData: { quantity_in_stock: 5, adjustment: -5, reason: 'usage' },
    }));
  });

  it('notifies inventory staff when the item drops to the reorder level and io is present', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', name: 'Aspirin', sku: 'S1', unit: 'tab', quantity_in_stock: 10, reorder_level: 20 }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] });
    const io = { of: vi.fn() };

    await inv.adjustQuantity('i1', -15, 'usage', 'u1', 'ip', 'ua', io);
    expect(createNotifMock).toHaveBeenCalledTimes(2);
    expect(createNotifMock.mock.calls[0][0]).toBe('u1');
    expect(createNotifMock.mock.calls[0][1]).toBe('ALERT');
    expect(createNotifMock.mock.calls[0][2]).toBe('Low stock alert');
    expect(createNotifMock.mock.calls[0][3]).toContain('Aspirin (SKU: S1) is at 10 tab — below reorder level of 20');
    expect(createNotifMock.mock.calls[0][5]).toBe(io);
  });

  it('does not query staff or notify when io is not provided', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', name: 'A', sku: 'S', unit: 'tab', quantity_in_stock: 10, reorder_level: 20 }] });
    await inv.adjustQuantity('i1', -15, 'usage', 'u1', 'ip', 'ua');
    expect(q).toHaveBeenCalledTimes(1);
    expect(createNotifMock).not.toHaveBeenCalled();
  });

  it('does not notify when stock is still above the reorder level', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', name: 'A', sku: 'S', unit: 'tab', quantity_in_stock: 50, reorder_level: 20 }] });
    await inv.adjustQuantity('i1', -5, 'usage', 'u1', 'ip', 'ua', {});
    expect(createNotifMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getBedMatrix / updateBedStatus
// ---------------------------------------------------------------------------
describe('inventory.service — getBedMatrix', () => {
  it('groups beds by room and attaches patient info', async () => {
    q.mockResolvedValueOnce({ rows: [
      { room_id: 'r1', room_number: '101', room_type: 'WARD', floor: 1, department_name: 'OPD', bed_id: 'b1', bed_number: 'B1', status: 'OCCUPIED', patient_first: 'John', patient_last: 'Doe', mrn: 'M1' },
      { room_id: 'r1', room_number: '101', room_type: 'WARD', floor: 1, department_name: 'OPD', bed_id: 'b2', bed_number: 'B2', status: 'AVAILABLE', patient_first: null, patient_last: null, mrn: null },
      { room_id: 'r2', room_number: '102', room_type: 'ICU', floor: 2, department_name: 'ICU', bed_id: null, bed_number: null, status: null, patient_first: null, patient_last: null, mrn: null },
    ] });
    const res = await inv.getBedMatrix();
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ id: 'r1', roomNumber: '101', departmentName: 'OPD' });
    expect(res[0].beds).toHaveLength(2);
    expect(res[0].beds[0].patient).toEqual({ firstName: 'John', lastName: 'Doe', mrn: 'M1' });
    expect(res[0].beds[1].patient).toBeNull();
    expect(res[1].beds).toEqual([]);
  });
});

describe('inventory.service — updateBedStatus', () => {
  it('returns null when the bed is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.updateBedStatus('b1', { status: 'OCCUPIED' }, 'u1', 'ip', 'ua')).toBeNull();
  });

  it('updates the bed and audits the status change', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'AVAILABLE' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'OCCUPIED' }] });
    const res = await inv.updateBedStatus('b1', { status: 'OCCUPIED', notes: 'x' }, 'u1', 'ip', 'ua');
    expect(res.status).toBe('OCCUPIED');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE_BED', prevData: { status: 'AVAILABLE' }, nextData: { status: 'OCCUPIED', notes: 'x' },
    }));
  });
});

// ---------------------------------------------------------------------------
// QR codes
// ---------------------------------------------------------------------------
describe('inventory.service — QR codes', () => {
  const UUID = '123e4567-e89b-12d3-a456-426614174000';

  it('generateQrData returns a signed code for an existing item', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow({ id: UUID })] });
    const res = await inv.generateQrData(UUID, 'u1', 'ip', 'ua');
    expect(res.code).toMatch(/^INV-[a-f0-9]{32}-[a-f0-9]{12}$/i);
    expect(res.item.id).toBe(UUID);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_QR', nextData: { code: res.code } }));
  });

  it('generateQrData returns null when the item is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.generateQrData(UUID, 'u1', 'ip', 'ua')).toBeNull();
  });

  it('lookupByQrCode returns null for malformed or tampered codes', async () => {
    expect(await inv.lookupByQrCode('INV-NOPE')).toBeNull();
    const tampered = `INV-${UUID.replace(/-/g, '')}-000000000000`;
    expect(await inv.lookupByQrCode(tampered)).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });

  it('lookupByQrCode resolves the item from a valid signed code', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow({ id: UUID })] });
    const res = await inv.lookupByQrCode(makeQrCode(UUID));
    expect(res.id).toBe(UUID);
    expect(q.mock.calls[0][1]).toEqual([UUID]);
  });
});

// ---------------------------------------------------------------------------
// getAlerts / getStats
// ---------------------------------------------------------------------------
describe('inventory.service — getAlerts', () => {
  it('returns low-stock and expiring items', async () => {
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    q.mockResolvedValueOnce({ rows: [itemRow({ id: 'i2', expiry_date: '2026-08-01' })] });
    const res = await inv.getAlerts();
    expect(res.lowStock).toHaveLength(1);
    expect(res.expiring).toHaveLength(1);
    expect(q.mock.calls[1][0]).toContain('i.expiry_date <= $1');
    expect(q.mock.calls[1][1][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('inventory.service — getStats', () => {
  it('returns parsed dashboard stats', async () => {
    q.mockResolvedValueOnce({ rows: [{ total_medicines: '10', total_equipment: '2', low_stock_count: '1' }] });
    q.mockResolvedValueOnce({ rows: [{ available: '20', total: '30' }] });
    expect(await inv.getStats()).toEqual({
      totalMedicines: 10, totalEquipment: 2, lowStockCount: 1, bedsAvailable: 20, bedsTotal: 30,
    });
  });
});

// ---------------------------------------------------------------------------
// importFromCsv
// ---------------------------------------------------------------------------
describe('inventory.service — importFromCsv', () => {
  const csv = [
    'name,sku,category,unit,quantity_in_stock,reorder_level,unit_cost',
    'Aspirin,SKU-1,MEDICINE,tab,100,20,5.5',
    'Gloves,SKU-2,CONSUMABLE,box,50,10,',
    'BadRow,,,,,,',
    'BadCat,SKU-3,NOPE,box,1,1,',
  ].join('\n');

  it('upserts valid rows and reports skipped rows with errors', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await inv.importFromCsv(Buffer.from(csv), 'u1', 'ip', 'ua');

    expect(res.created).toBe(2);
    expect(res.skipped).toBe(2);
    expect(res.errors).toEqual([
      { row: 4, error: 'Missing required fields: name, sku, category, unit' },
      { row: 5, error: 'Invalid category: NOPE' },
    ]);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CSV_IMPORT', nextData: { created: 2, skipped: 2 },
    }));

    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (sku) DO UPDATE');
    expect(params).toEqual(['Aspirin', 'SKU-1', 'MEDICINE', 'tab', 100, 20, 5.5, null, null, null]);
    expect(q.mock.calls[1][1]).toEqual(['Gloves', 'SKU-2', 'CONSUMABLE', 'box', 50, 10, null, null, null, null]);
  });

  it('counts a failing upsert as skipped with the error message', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    q.mockRejectedValueOnce(new Error('db down'));
    const res = await inv.importFromCsv(Buffer.from(csv), 'u1', 'ip', 'ua');
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(3); // 2 invalid + 1 db failure
    expect(res.errors).toContainEqual({ row: 3, error: 'db down' });
  });
});

// ---------------------------------------------------------------------------
// createRoom / createBed
// ---------------------------------------------------------------------------
describe('inventory.service — createRoom/createBed', () => {
  it('createRoom inserts and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'r1', room_number: '101' }] });
    const res = await inv.createRoom({ roomNumber: '101', roomType: 'WARD', floor: 1, departmentId: 'dep1' }, 'u1', 'ip', 'ua');
    expect(res.id).toBe('r1');
    expect(q.mock.calls[0][1]).toEqual(['101', 'WARD', 1, 'dep1']);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'rooms' }));
  });

  it('createBed returns null when the room is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await inv.createBed({ roomId: 'r1', bedNumber: 'B1' }, 'u1', 'ip', 'ua')).toBeNull();
  });

  it('createBed inserts an AVAILABLE bed and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'AVAILABLE' }] });
    const res = await inv.createBed({ roomId: 'r1', bedNumber: 'B1' }, 'u1', 'ip', 'ua');
    expect(res.status).toBe('AVAILABLE');
    expect(q.mock.calls[1][1]).toEqual(['r1', 'B1']);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'beds' }));
  });
});
