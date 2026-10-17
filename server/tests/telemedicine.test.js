// Coverage for the telemedicine module: room token verification, session
// creation (patient/doctor/appointment validation, notifications + reminder
// scheduling), session listing, room-token gating (time windows, roles),
// ending a session, and the reminder worker.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, withTx,
  auditMock, notifMock, loggerError, loggerInfo,
  QueueMock, WorkerMock,
} = vi.hoisted(() => {
  class Queue {
    constructor() { this.add = vi.fn(); this.getJob = vi.fn(); }
  }
  class Worker {
    constructor(name, processor, opts) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      this.on = vi.fn();
    }
  }
  return {
    q: vi.fn(), withTx: vi.fn(),
    auditMock: vi.fn(), notifMock: vi.fn(),
    loggerError: vi.fn(), loggerInfo: vi.fn(),
    QueueMock: Queue, WorkerMock: Worker,
  };
});

vi.mock('bullmq', () => ({
  Queue: QueueMock,
  Worker: WorkerMock,
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: withTx,
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt: async (v) => (v == null ? null : `enc(${v})`),
  pgDecrypt: async (v) => (v == null ? null : v),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: notifMock,
  NotificationType  : { TELEMEDICINE_REMINDER: 'TELEMEDICINE_REMINDER' },
}));

vi.mock('../src/shared/jobs/queue.js', () => ({
  emailQueue: { add: vi.fn(), getJob: vi.fn() },
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, info: loggerInfo, warn: vi.fn() },
}));

import * as tele from '../src/modules/telemedicine/telemedicine.service.js';
import { teleQueue } from '../src/modules/telemedicine/telemedicine.service.js';
import { startTelemedicineWorker } from '../src/modules/telemedicine/telemedicine.worker.js';

const SECRET = 'test-tele-secret';
const flush = () => new Promise((r) => setImmediate(r));

function roomToken(sessionId) {
  const sig = crypto.createHmac('sha256', SECRET).update(sessionId).digest('hex').slice(0, 16);
  return sessionId.replace(/-/g, '') + '-' + sig;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.TELE_ROOM_SECRET = SECRET;
  withTx.mockImplementation(async (fn) => fn({ query: vi.fn() }));
  auditMock.mockImplementation(async () => {});
  notifMock.mockResolvedValue({});
  teleQueue.add.mockResolvedValue({});
  teleQueue.getJob.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.TELE_ROOM_SECRET;
});

// ---------------------------------------------------------------------------
// verifyRoomId
// ---------------------------------------------------------------------------
describe('telemedicine.service — verifyRoomId', () => {
  it('verifies a valid room id', () => {
    expect(tele.verifyRoomId('sess-1', roomToken('sess-1'))).toBe(true);
  });

  it('rejects a tampered room id of the same length', () => {
    expect(tele.verifyRoomId('sess-1', roomToken('sess-2'))).toBe(false);
  });

  it('throws on mismatched-length input', () => {
    expect(() => tele.verifyRoomId('sess-1', 'short')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
const PATIENT = { id: 'p1', first_name: 'Ann', last_name: 'A', email: 'a@x.com', user_id: 'patUser' };
const DOCTOR  = { id: 'doc1', first_name: 'Bob', last_name: 'B', email: 'b@x.com' };
const APPT    = { id: 'appt1', scheduled_at: '2999-01-01T00:00:00.000Z', duration_minutes: 30 };

function createSessionSuccessSetup() {
  q.mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [DOCTOR] })
    .mockResolvedValueOnce({ rows: [APPT] })
    .mockResolvedValueOnce({ rows: [] })                 // existing sessions
    .mockResolvedValueOnce({ rows: [{ id: 's1', room_token: roomToken('s1') }] }); // INSERT
}

describe('telemedicine.service — createSession', () => {
  it('throws 404 when the patient is not found', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null))
      .rejects.toMatchObject({ status: 404, message: 'Patient not found' });
  });

  it('throws 404 when the doctor is not found', async () => {
    q.mockResolvedValueOnce({ rows: [PATIENT] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null))
      .rejects.toMatchObject({ status: 404, message: 'Doctor not found' });
  });

  it('throws 404 when the appointment is missing or not telemedicine', async () => {
    q.mockResolvedValueOnce({ rows: [PATIENT] })
      .mockResolvedValueOnce({ rows: [DOCTOR] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null))
      .rejects.toMatchObject({ status: 404, message: 'Appointment not found or not a telemedicine appointment' });
  });

  it('returns the existing active session instead of creating a new one', async () => {
    q.mockResolvedValueOnce({ rows: [PATIENT] })
      .mockResolvedValueOnce({ rows: [DOCTOR] })
      .mockResolvedValueOnce({ rows: [APPT] })
      .mockResolvedValueOnce({ rows: [{ id: 'old', room_token: roomToken('old') }] });

    const res = await tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null);
    expect(res).toEqual({ id: 'old', room_token: roomToken('old'), room_id: roomToken('old') });
  });

  it('creates a session, audits, and schedules reminder + notifications', async () => {
    createSessionSuccessSetup();
    const res = await tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null);

    expect(res.room_id).toBe(roomToken(res.id));
    expect(auditMock).toHaveBeenCalledWith('admin', 'CREATE', 'telemedicine_sessions', res.id, null,
      { patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'ip', 'ua');

    await flush();
    await flush();
    await flush();

    expect(notifMock).toHaveBeenCalledTimes(2);
    expect(notifMock).toHaveBeenCalledWith('doc1', 'TELEMEDICINE_REMINDER', 'Telemedicine session ready',
      expect.stringContaining('Session with Ann A'), { entityType: 'TELEMEDICINE', entityId: res.id, priority: 'MEDIUM' }, null);
    expect(notifMock).toHaveBeenCalledWith('patUser', 'TELEMEDICINE_REMINDER', 'Telemedicine session ready',
      expect.stringContaining('Your video consultation with Dr. Bob B'), { entityType: 'TELEMEDICINE', entityId: res.id, priority: 'MEDIUM' }, null);
    expect(teleQueue.add).toHaveBeenCalledWith('reminder',
      { sessionId: res.id, doctorId: 'doc1', patientUserId: 'patUser' },
      { delay: expect.any(Number), jobId: 'reminder:' + res.id });
  });

  it('skips the queued reminder when the session is imminent or past', async () => {
    q.mockResolvedValueOnce({ rows: [PATIENT] })
      .mockResolvedValueOnce({ rows: [DOCTOR] })
      .mockResolvedValueOnce({ rows: [{ ...APPT, scheduled_at: '2000-01-01T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 's1', room_token: roomToken('s1') }] });

    await tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null);
    await flush();
    await flush();
    await flush();
    expect(teleQueue.add).not.toHaveBeenCalled();
  });

  it('logs notification failures without throwing', async () => {
    createSessionSuccessSetup();
    notifMock.mockRejectedValueOnce(new Error('push down'));
    await tele.createSession({ patientId: 'p1', doctorId: 'doc1', appointmentId: 'appt1' }, 'admin', 'ip', 'ua', null);
    await flush();
    await flush();
    await flush();
    expect(loggerError).toHaveBeenCalledWith('[tele] Post-create notifications failed', { message: 'push down' });
  });
});

// ---------------------------------------------------------------------------
// getSessionById
// ---------------------------------------------------------------------------
describe('telemedicine.service — getSessionById', () => {
  it('returns a session or null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 's1', room_id: 'tok' }] });
    expect(await tele.getSessionById('s1')).toEqual({ id: 's1', room_id: 'tok' });
    q.mockResolvedValueOnce({ rows: [] });
    expect(await tele.getSessionById('nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listMySessions
// ---------------------------------------------------------------------------
describe('telemedicine.service — listMySessions', () => {
  it('uses patient scoping when the user has the PATIENT role', async () => {
    q.mockResolvedValue({ rows: [] });
    await tele.listMySessions('u1', ['PATIENT'], { page: 1, limit: 10, status: 'ACTIVE' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('pt.user_id = $1');
    expect(sql).toContain('WHERE 1=1 AND ts.status = $4');
    expect(sql).toContain('LIMIT $2 OFFSET $3');
    expect(params).toEqual(['u1', 10, 0, 'ACTIVE']);
  });

  it('uses doctor scoping without a status filter', async () => {
    q.mockResolvedValue({ rows: [] });
    await tele.listMySessions('doc1', ['DOCTOR'], { page: 1, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE ts.doctor_id = $1');
    expect(sql).not.toContain('ts.status');
    expect(params).toEqual(['doc1', 10, 0]);
  });

  it('strips total_count and returns totals', async () => {
    q.mockResolvedValue({ rows: [{ id: 's1', total_count: '2' }] });
    const res = await tele.listMySessions('doc1', ['DOCTOR'], { page: 2, limit: 5 });
    expect(res).toEqual({ sessions: [{ id: 's1' }], total: 2, page: 2, limit: 5 });
  });
});

// ---------------------------------------------------------------------------
// getRoomToken
// ---------------------------------------------------------------------------
function sessionRow(overrides = {}) {
  return {
    id: 's1', doctor_id: 'doc1', patient_id: 'p1', patient_user_id: 'patUser',
    room_id: 'tok', scheduled_at: new Date(Date.now() - 60000).toISOString(),
    duration_minutes: 30, status: 'WAITING', ...overrides,
  };
}

describe('telemedicine.service — getRoomToken', () => {
  it('throws 404 when the session is missing', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(tele.getRoomToken('s1', 'doc1', ['DOCTOR']))
      .rejects.toMatchObject({ status: 404, message: 'Session not found' });
  });

  it('throws 403 for a non-participant', async () => {
    q.mockResolvedValue({ rows: [sessionRow()] });
    await expect(tele.getRoomToken('s1', 'stranger', ['NURSE']))
      .rejects.toMatchObject({ status: 403, message: 'Not a participant in this session' });
  });

  it('throws TOO_EARLY before the window opens', async () => {
    q.mockResolvedValue({ rows: [sessionRow({ scheduled_at: new Date(Date.now() + 30 * 60000).toISOString() })] });
    await expect(tele.getRoomToken('s1', 'doc1', ['DOCTOR']))
      .rejects.toMatchObject({ status: 403, code: 'TOO_EARLY' });
  });

  it('throws EXPIRED when past expiry and not active', async () => {
    q.mockResolvedValue({ rows: [sessionRow({ scheduled_at: new Date(Date.now() - 120 * 60000).toISOString() })] });
    await expect(tele.getRoomToken('s1', 'doc1', ['DOCTOR']))
      .rejects.toMatchObject({ status: 403, code: 'EXPIRED' });
  });

  it('allows an expired session when it is already ACTIVE', async () => {
    q.mockResolvedValue({ rows: [sessionRow({ scheduled_at: new Date(Date.now() - 120 * 60000).toISOString(), status: 'ACTIVE' })] });
    const res = await tele.getRoomToken('s1', 'doc1', ['DOCTOR']);
    expect(res.roomId).toBe('tok');
    expect(res.role).toBe('doctor');
  });

  it('activates a WAITING session and returns participant info', async () => {
    q.mockResolvedValueOnce({ rows: [sessionRow()] })
      .mockResolvedValueOnce({});
    const res = await tele.getRoomToken('s1', 'doc1', ['DOCTOR']);
    expect(q.mock.calls[1][0]).toContain("status = 'ACTIVE'");
    expect(res).toMatchObject({ roomId: 'tok', sessionId: 's1', role: 'doctor', doctorId: 'doc1', patientId: 'p1' });
    expect(res.expiresAt).toBeTruthy();
  });

  it('returns a patient role for a patient participant', async () => {
    q.mockResolvedValue({ rows: [sessionRow()] });
    const res = await tele.getRoomToken('s1', 'patUser', ['PATIENT']);
    expect(res.role).toBe('patient');
  });

  it('admins can join and are treated as patients', async () => {
    q.mockResolvedValue({ rows: [sessionRow()] });
    const res = await tele.getRoomToken('s1', 'admin1', ['ADMIN']);
    expect(res.role).toBe('patient');
  });
});

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------
describe('telemedicine.service — endSession', () => {
  it('throws 404 when the session is missing', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(tele.endSession('s1', 'doc1', {}, 'ip', 'ua'))
      .rejects.toMatchObject({ status: 404, message: 'Session not found' });
  });

  it('throws 403 when a non-doctor tries to end the session', async () => {
    q.mockResolvedValue({ rows: [{ id: 's1', doctor_id: 'doc1', patient_id: 'p1', status: 'ACTIVE' }] });
    await expect(tele.endSession('s1', 'patUser', {}, 'ip', 'ua'))
      .rejects.toMatchObject({ status: 403, message: 'Only the doctor can end the session' });
  });

  it('ends the session, removes the reminder job and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 's1', doctor_id: 'doc1', patient_id: 'p1', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({});
    const job = { remove: vi.fn().mockResolvedValue() };
    teleQueue.getJob.mockResolvedValue(job);

    const res = await tele.endSession('s1', 'doc1', {}, 'ip', 'ua');

    expect(q.mock.calls[1][0]).toContain("status = 'COMPLETED'");
    expect(teleQueue.getJob).toHaveBeenCalledWith('reminder:s1');
    expect(job.remove).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith('doc1', 'END_SESSION', 'telemedicine_sessions', 's1',
      { status: 'ACTIVE' }, { status: 'COMPLETED', hasNote: false }, 'ip', 'ua');
    expect(res).toEqual({ ok: true });
  });

  it('writes an encrypted medical record note when provided', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 's1', doctor_id: 'doc1', patient_id: 'p1', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({})                    // UPDATE session
      .mockResolvedValueOnce({});                   // INSERT medical record
    const res = await tele.endSession('s1', 'doc1', { consultationNote: '  All good  ' }, 'ip', 'ua');

    const insert = q.mock.calls[2][0];
    expect(insert).toContain('INSERT INTO medical_records');
    expect(insert).toContain('attending_doctor_id');
    expect(q.mock.calls[2][1]).toEqual(['p1', 'doc1', 'enc(All good)']);
    expect(auditMock).toHaveBeenCalledWith('doc1', 'END_SESSION', 'telemedicine_sessions', 's1',
      { status: 'ACTIVE' }, { status: 'COMPLETED', hasNote: true }, 'ip', 'ua');
    expect(res).toEqual({ ok: true });
  });

  it('ignores reminder removal failures', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 's1', doctor_id: 'doc1', patient_id: 'p1', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({});
    teleQueue.getJob.mockRejectedValue(new Error('redis gone'));
    const res = await tele.endSession('s1', 'doc1', {}, 'ip', 'ua');
    expect(res).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// startTelemedicineWorker
// ---------------------------------------------------------------------------
describe('telemedicine.worker — startTelemedicineWorker', () => {
  it('returns a worker and registers the failed handler', () => {
    const worker = startTelemedicineWorker({});
    expect(worker).toBeInstanceOf(WorkerMock);
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('skips non-reminder jobs', async () => {
    const worker = startTelemedicineWorker({});
    await worker.processor({ name: 'other', data: {} });
    expect(q).not.toHaveBeenCalled();
  });

  it('skips jobs whose session is missing or not scheduled', async () => {
    const worker = startTelemedicineWorker({});
    q.mockResolvedValueOnce({ rows: [] });
    await worker.processor({ name: 'reminder', data: { sessionId: 's1' } });
    expect(notifMock).not.toHaveBeenCalled();

    q.mockResolvedValueOnce({ rows: [{ status: 'ACTIVE' }] });
    await worker.processor({ name: 'reminder', data: { sessionId: 's1' } });
    expect(notifMock).not.toHaveBeenCalled();
  });

  it('sends 15-minute reminders to doctor and patient', async () => {
    const worker = startTelemedicineWorker({ io: true });
    q.mockResolvedValue({ rows: [{ status: 'SCHEDULED', scheduled_at: '2999-01-01T00:00:00.000Z' }] });
    await worker.processor({ name: 'reminder', data: { sessionId: 's1', doctorId: 'doc1', patientUserId: 'patUser' } });
    expect(notifMock).toHaveBeenCalledTimes(2);
    expect(loggerInfo).toHaveBeenCalledWith('[tele-worker] Sent 15-min reminders', { sessionId: 's1' });
  });

  it('skips the patient notification when there is no patient user', async () => {
    const worker = startTelemedicineWorker({ io: true });
    q.mockResolvedValue({ rows: [{ status: 'SCHEDULED', scheduled_at: '2999-01-01T00:00:00.000Z' }] });
    await worker.processor({ name: 'reminder', data: { sessionId: 's1', doctorId: 'doc1', patientUserId: null } });
    expect(notifMock).toHaveBeenCalledTimes(1);
    expect(loggerInfo).toHaveBeenCalled();
  });
});
