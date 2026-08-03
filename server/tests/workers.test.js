// Coverage for the BullMQ worker job handlers (email, notification, report).
// The handlers live in worker-handlers.js and lazy-import their dependencies,
// so these tests exercise each worker's processing path without Redis/SMTP/DB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  sendMailMock, pushMock, q, setexMock, genReportMock, reportKeyMock,
  loggerInfo, loggerWarn, loggerError,
} = vi.hoisted(() => ({
  sendMailMock : vi.fn(),
  pushMock     : vi.fn(),
  q            : vi.fn(),
  setexMock    : vi.fn(),
  genReportMock: vi.fn(),
  reportKeyMock: vi.fn(),
  loggerInfo   : vi.fn(),
  loggerWarn   : vi.fn(),
  loggerError  : vi.fn(),
}));

vi.mock('../src/shared/services/mailer.js', () => ({
  sendMail   : sendMailMock,
  transporter: {},
  FROM       : '"HMS" <hms@hospital.local>',
}));

vi.mock('../src/shared/services/webpush.service.js', () => ({
  sendPushNotification: pushMock,
  pushEnabled         : vi.fn(() => true),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query        : q,
  pool         : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: { setex: setexMock },
}));

vi.mock('../src/modules/analytics/report.service.js', () => ({
  generateReport : genReportMock,
  reportJobKey   : reportKeyMock,
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { info: loggerInfo, warn: loggerWarn, error: loggerError, debug: vi.fn() },
}));

import { processEmailJob, processNotificationJob, processReportJob } from '../src/shared/jobs/worker-handlers.js';

beforeEach(() => {
  vi.resetAllMocks();
  reportKeyMock.mockImplementation((id) => `report:job:${id}`);
  sendMailMock.mockResolvedValue({ messageId: 'm1' });
  pushMock.mockResolvedValue();
  q.mockResolvedValue({ rows: [] });
  setexMock.mockResolvedValue();
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('processEmailJob', () => {
  it('sends an email for a valid job payload', async () => {
    const job = {
      id: 'e1', name: 'tempPassword',
      data: { to: 'a@b.c', subject: 'Welcome', html: '<p>hi</p>' },
    };

    await processEmailJob(job);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({ to: 'a@b.c', subject: 'Welcome', html: '<p>hi</p>' });
  });

  it('throws on a payload missing required fields', async () => {
    const job = { id: 'e2', name: 'otp', data: { to: 'a@b.c' } };

    await expect(processEmailJob(job)).rejects.toThrow(/Invalid email job payload/);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('processNotificationJob', () => {
  it('sends a push to a specific user', async () => {
    const job = {
      id: 'n1', name: 'push',
      data: { userId: 'u1', type: 'LEAVE', title: 'Approved', body: 'done', entityId: 'l1' },
    };

    await processNotificationJob(job);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('u1', { title: 'Approved', body: 'done', data: { type: 'LEAVE', entityId: 'l1' } });
    expect(q).not.toHaveBeenCalled();
  });

  it('broadcasts to all users holding a role', async () => {
    q.mockResolvedValue({ rows: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const job = {
      id: 'n2', name: 'push',
      data: { targetRole: 'DOCTOR', type: 'LEAVE', title: 'Approved', body: 'done', entityId: 'l1' },
    };

    await processNotificationJob(job);

    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toContain('SELECT DISTINCT ur.user_id');
    expect(pushMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a push with neither userId nor targetRole', async () => {
    const job = { id: 'n3', name: 'push', data: { type: 'LEAVE', title: 'T', body: 'B' } };

    await processNotificationJob(job);

    expect(pushMock).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
  });

  it('skips SMS when Twilio env vars are not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const job = { id: 'n4', name: 'sms', data: { phone: '+1000', message: 'hi' } };

    await processNotificationJob(job);

    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('SMS skipped'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns when an SMS job is missing phone or message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const job = { id: 'n5', name: 'sms', data: { phone: '+1000' } };

    await processNotificationJob(job);

    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('missing phone or message'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends SMS via the Twilio REST API when configured', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN  = 'tok';
    process.env.TWILIO_FROM_NUMBER = '+1555';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const job = { id: 'n6', name: 'sms', data: { phone: '+1000', message: 'hi there' } };
    await processNotificationJob(job);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/Accounts/AC123/Messages.json');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Basic ' + Buffer.from('AC123:tok').toString('base64'));
    expect(loggerInfo).toHaveBeenCalledWith(expect.stringContaining('SM999'));
  });

  it('throws a descriptive error when Twilio responds with an error', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN  = 'tok';
    process.env.TWILIO_FROM_NUMBER = '+1555';

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'bad request' }) });
    vi.stubGlobal('fetch', fetchMock);

    const job = { id: 'n7', name: 'sms', data: { phone: '+1000', message: 'hi' } };

    await expect(processNotificationJob(job)).rejects.toThrow(/Twilio error 400: bad request/);
  });

  it('logs a warning for an unknown job type', async () => {
    const job = { id: 'n8', name: 'unknown', data: {} };

    await processNotificationJob(job);

    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('Unknown job type'));
  });
});

describe('processReportJob', () => {
  it('marks the job completed in Redis and DB history on success', async () => {
    genReportMock.mockResolvedValue({ filename: 'r.pdf', downloadKey: 'report:file:r.pdf', mimeType: 'application/pdf' });
    const job = { id: 'r1', name: 'generate', data: { type: 'patient', format: 'pdf', period: '2026-01-01' } };

    await processReportJob(job);

    expect(genReportMock).toHaveBeenCalledWith(job.data);
    expect(setexMock).toHaveBeenCalledWith(
      'report:job:r1',
      60 * 60,
      expect.stringContaining('"status":"completed"')
    );
    expect(q).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE report_jobs'),
      ['report:file:r.pdf', 'r1']
    );
  });

  it('records a failed status in Redis and rethrows on generation failure', async () => {
    genReportMock.mockRejectedValue(new Error('boom'));
    const job = { id: 'r2', name: 'generate', data: { type: 'patient', format: 'pdf', period: '2026-01-01' } };

    await expect(processReportJob(job)).rejects.toThrow('boom');

    expect(setexMock).toHaveBeenCalledWith(
      'report:job:r2',
      60 * 60,
      expect.stringContaining('"status":"failed"')
    );
  });
});
