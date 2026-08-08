// DB-backed integration test for the report-status polling path.
//
// redis.service.js get() auto-parses JSON, and getReportStatus() JSON.parsed
// the result AGAIN — JSON.parse({...}) coerces to "[object Object]" and throws,
// so every status poll returned null (→ 404). This test proves status polling
// returns the parsed status, and that the DB fallback reads a real report_jobs
// row against the real schema.

import { describe, it, expect, vi } from 'vitest';

const { redisGet, redisSetex, queueAdd } = vi.hoisted(() => ({
  redisGet  : vi.fn(),
  redisSetex: vi.fn(),
  queueAdd  : vi.fn(),
}));

vi.mock('../../src/shared/jobs/queue.js', () => ({
  reportQueue: { add: queueAdd },
}));

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { get: redisGet, setex: redisSetex },
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { enqueueReport, getReportStatus } from '../../src/modules/analytics/report.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

describe('report jobs — status polling against the real schema', () => {
  it('enqueueReport persists a real row; getReportStatus falls back to the DB on a redis miss', async () => {
    const { rows: [u] } = await run(
      `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
       VALUES (gen_random_uuid(), $1, 'Report', 'User', $2, $3) RETURNING id`,
      [uniq('E-INT-RPT'), uniq('rptuser') + '@example.com', 'x'.repeat(60)]
    );

    queueAdd.mockResolvedValue({ id: 'job-123' });
    redisSetex.mockResolvedValue('OK');
    redisGet.mockResolvedValue(null);

    const { jobId } = await enqueueReport({ type: 'patient', format: 'csv', period: '30d' }, u.id);
    expect(jobId).toBe('job-123');

    const status = await getReportStatus(jobId);
    expect(status).toBeTruthy();
    expect(status.job_id).toBe('job-123');
    expect(status.status).toBe('pending');
    expect(status.user_id).toBe(u.id);
  });

  it('returns the redis-parsed status object as-is (no double parse)', async () => {
    const payload = { status: 'completed', type: 'financial', format: 'pdf', period: '7d' };
    redisGet.mockResolvedValue(payload);

    const status = await getReportStatus('job-xyz');
    expect(status).toEqual(payload);
    expect(status.status).toBe('completed');
  });

  it('returns null when neither redis nor the DB has the job', async () => {
    redisGet.mockResolvedValue(null);
    expect(await getReportStatus('job-nope')).toBeNull();
  });
});
