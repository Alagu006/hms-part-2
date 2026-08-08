// Coverage for the appointments module: list/get/update flows,
// patient self-service cancel/update scoping, and post-create notifications.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, createNotifMock, loggerError, loggerWarn,
} = vi.hoisted(() => ({
  q: vi.fn(),
  createNotifMock: vi.fn(async () => ({ id: 'n1' })),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt: async (v) => (v == null ? null : `enc(${v})`),
  pgDecrypt: async (v) => (v == null ? null : (typeof v === 'string' && v.startsWith('enc(') ? v.slice(4, -1) : v)),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : {
    APPOINTMENT_BOOKED   : 'APPOINTMENT',
    LAB_ORDER_CREATED    : 'LAB_ORDER',
    PRESCRIPTION_ISSUED  : 'PRESCRIPTION',
    VITALS_CRITICAL      : 'ALERT',
    EMERGENCY_ALERT      : 'EMERGENCY_ALERT',
    DRUG_INTERACTION_WARN: 'ALERT',
    BLOOD_REQUEST        : 'BLOOD_REQUEST',
  },
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, warn: loggerWarn, info: vi.fn(), debug: vi.fn() },
}));

import * as appt from '../src/modules/appointments/appointments.service.js';

function apptRow(overrides = {}) {
  return {
    id: 'a1', patient_id: 'p1', doctor_id: 'd1', department_id: 'dep1',
    scheduled_at: '2026-01-02T10:00:00Z', duration_minutes: 30,
    type: 'IN_PERSON', status: 'SCHEDULED', reason: 'fever', notes: null,
    cancellation_reason: null, patient_first_name: 'John', patient_last_name: 'Doe',
    mrn: 'MRN-1', doctor_first_name: 'Dr', doctor_last_name: 'A',
    department_name: 'OPD', ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'] });
  createNotifMock.mockImplementation(async () => ({ id: 'n1' }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// listAppointments — filters + pagination
// ---------------------------------------------------------------------------
describe('appointments.service — listAppointments', () => {
  it('lists with no filters using default pagination', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow({ total_count: '1' })] });
    const res = await appt.listAppointments({ page: 1, limit: 20 });
    expect(res.appointments).toHaveLength(1);
    expect(res.appointments[0]).not.toHaveProperty('total_count');
    expect(res.total).toBe(1);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE a.deleted_at IS NULL');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([20, 0]);
  });

  it('builds WHERE clauses and placeholders for doctor/patient/date/status', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await appt.listAppointments({
      doctorId: 'd1', patientId: 'p1', date: '2026-01-02', status: 'SCHEDULED',
      page: 2, limit: 10,
    });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('a.doctor_id = $1');
    expect(sql).toContain('a.patient_id = $2');
    expect(sql).toContain('DATE(a.scheduled_at) = $3');
    expect(sql).toContain('a.status = $4');
    expect(sql).toContain('LIMIT $5 OFFSET $6');
    expect(params).toEqual(['d1', 'p1', '2026-01-02', 'SCHEDULED', 10, 10]);
  });

  it('returns a zero total for an empty list', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const res = await appt.listAppointments({ page: 1, limit: 10 });
    expect(res.total).toBe(0);
    expect(res.appointments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAppointmentById
// ---------------------------------------------------------------------------
describe('appointments.service — getAppointmentById', () => {
  it('returns the appointment row', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    expect(await appt.getAppointmentById('a1')).toMatchObject({ id: 'a1' });
    expect(q.mock.calls[0][1]).toEqual(['a1']);
  });

  it('returns null when missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await appt.getAppointmentById('a1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateAppointmentStatus
// ---------------------------------------------------------------------------
describe('appointments.service — updateAppointmentStatus', () => {
  it('returns null when the appointment is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await appt.updateAppointmentStatus('a1', { status: 'CANCELLED' }, 'u')).toBeNull();
  });

  it('cancels an appointment and records who cancelled', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow({ status: 'CANCELLED', cancellation_reason: 'no show' })] });
    const res = await appt.updateAppointmentStatus('a1', { status: 'CANCELLED', notes: 'nope' }, 'u-staff');
    expect(res.status).toBe('CANCELLED');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("cancelled_at = CASE WHEN $1 = 'CANCELLED' THEN NOW() ELSE cancelled_at END");
    expect(params).toEqual(['CANCELLED', 'enc(nope)', 'u-staff', 'a1']);
  });

  it('uses existing notes when no new notes are provided', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow({ status: 'COMPLETED' })] });
    await appt.updateAppointmentStatus('a1', { status: 'COMPLETED' }, null);
    expect(q.mock.calls[0][1]).toEqual(['COMPLETED', null, null, 'a1']);
    expect(q.mock.calls[0][0]).toContain('notes = COALESCE($2, notes)');
  });
});

// ---------------------------------------------------------------------------
// patientUpdateAppointment — self-service scoping (security)
// ---------------------------------------------------------------------------
describe('appointments.service — patientUpdateAppointment', () => {
  it('returns null when the appointment is not the patient’s or not SCHEDULED', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await appt.patientUpdateAppointment('a1', 'u-pat', { action: 'cancel' })).toBeNull();
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('cancels the patient’s own scheduled appointment', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    q.mockResolvedValueOnce({ rows: [apptRow({ status: 'CANCELLED', cancellation_reason: 'busy' })] });
    const res = await appt.patientUpdateAppointment('a1', 'u-pat', { action: 'cancel', cancellationReason: 'busy' });
    expect(res.status).toBe('CANCELLED');
    const [sql, params] = q.mock.calls[1];
    expect(sql).toContain("cancelled_by = (SELECT id FROM patients WHERE user_id = $2)");
    expect(params).toEqual(['enc(busy)', 'u-pat', 'a1']);
  });

  it('updates only provided fields via COALESCE', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    q.mockResolvedValueOnce({ rows: [apptRow({ scheduled_at: '2026-02-02T09:00:00Z', type: 'TELEMEDICINE' })] });
    const res = await appt.patientUpdateAppointment('a1', 'u-pat', {
      action: 'update', scheduledAt: '2026-02-02T09:00:00Z', type: 'TELEMEDICINE', reason: null,
    });
    expect(res.scheduled_at).toBe('2026-02-02T09:00:00Z');
    const [sql, params] = q.mock.calls[1];
    expect(sql).toContain('scheduled_at = COALESCE($1, scheduled_at)');
    expect(params).toEqual(['2026-02-02T09:00:00Z', 'TELEMEDICINE', null, 'a1']);
  });
});

// ---------------------------------------------------------------------------
// createAppointment — insert + async patient notification
// ---------------------------------------------------------------------------
describe('appointments.service — createAppointment', () => {
  const data = {
    patientId: 'p1', doctorId: 'd1', departmentId: 'dep1',
    scheduledAt: '2026-01-02T10:00:00Z', durationMinutes: 30,
    type: 'IN_PERSON', reason: 'fever',
  };

  it('inserts the appointment and returns it', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-pat' }] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'John', last_name: 'Smith' }] });

    const res = await appt.createAppointment(data, 'u-staff');
    expect(res.id).toBe('a1');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'SCHEDULED', $7, $8, NOW(), NOW())");
    expect(params).toEqual(['p1', 'd1', 'dep1', '2026-01-02T10:00:00Z', 30, 'IN_PERSON', 'enc(fever)', 'u-staff']);
  });

  it('notifies the patient after the insert completes', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-pat' }] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'John', last_name: 'Smith' }] });

    await appt.createAppointment(data, 'u-staff');
    await vi.runAllTimersAsync();

    expect(createNotifMock).toHaveBeenCalledTimes(1);
    const [userId, type, title, body, metadata] = createNotifMock.mock.calls[0];
    expect(userId).toBe('u-pat');
    expect(type).toBe('APPOINTMENT');
    expect(title).toBe('Appointment booked');
    expect(body).toContain('Dr. John Smith');
    expect(metadata).toMatchObject({ entityType: 'APPOINTMENT', entityId: 'a1', priority: 'MEDIUM' });
  });

  it('uses telemedicine wording for video consultations', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-pat' }] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'Jane', last_name: 'Doe' }] });

    await appt.createAppointment({ ...data, type: 'TELEMEDICINE' }, 'u-staff');
    await vi.runAllTimersAsync();

    const [, , title, body] = createNotifMock.mock.calls[0];
    expect(title).toBe('Telemedicine appointment booked');
    expect(body).toContain('video consultation');
    expect(body).toContain('Join from My Appointments');
  });

  it('skips the notification when the patient row is missing', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'John', last_name: 'Smith' }] });

    await appt.createAppointment(data, 'u-staff');
    await vi.runAllTimersAsync();
    expect(createNotifMock).not.toHaveBeenCalled();
  });

  it('skips the notification when the doctor row is missing', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-pat' }] });
    q.mockResolvedValueOnce({ rows: [] });

    await appt.createAppointment(data, 'u-staff');
    await vi.runAllTimersAsync();
    expect(createNotifMock).not.toHaveBeenCalled();
  });

  it('logs an error when the async notification fails', async () => {
    q.mockResolvedValueOnce({ rows: [apptRow()] });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-pat' }] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'John', last_name: 'Smith' }] });
    createNotifMock.mockRejectedValueOnce(new Error('db down'));

    await appt.createAppointment(data, 'u-staff');
    await vi.runAllTimersAsync();
    expect(loggerError).toHaveBeenCalledWith('[appointments] Post-create notification failed', expect.anything());
  });
});
