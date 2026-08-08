// Coverage for the shared DB pool wrapper: slow-query and error logs must
// redact encryption secrets (PG_CRYPTO_KEY / DB_ENCRYPTION_KEY) whenever they
// appear in bound params or SQL — services routinely pass these as query
// arguments (e.g. auth.login, visitors.searchPastVisitors).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerWarn : vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: {
    warn : loggerWarn,
    error: loggerError,
    info : vi.fn(),
    debug: vi.fn(),
  },
}));

const CRYPTO_KEY  = 'k3y-0123456789abcdef';
const ENCRYPT_KEY = 'e'.repeat(64);

beforeEach(() => {
  vi.resetModules();
  process.env.SLOW_QUERY_THRESHOLD_MS = '-1';
  process.env.PG_CRYPTO_KEY          = CRYPTO_KEY;
  process.env.DB_ENCRYPTION_KEY      = ENCRYPT_KEY;
  loggerWarn.mockReset();
  loggerError.mockReset();
});

async function loadPool() {
  return import('../src/shared/db/pool.js');
}

describe('pool.redact', () => {
  it('masks every configured secret, leaving surrounding text intact', async () => {
    const { redact } = await loadPool();
    expect(redact(`prefix-${CRYPTO_KEY}-suffix ${ENCRYPT_KEY}`))
      .toBe('prefix-[REDACTED]-suffix [REDACTED]');
  });

  it('does not alter log lines that contain no secrets', async () => {
    const { redact } = await loadPool();
    expect(redact('patient_name "Jones", ward "ICU"')).toBe('patient_name "Jones", ward "ICU"');
  });
});

describe('pool.query slow-query logging', () => {
  it('logs redacted params and SQL, never the raw key', async () => {
    const { query } = await loadPool();
    const client = {
      query: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { rows: [] };
      }),
    };

    await query('SELECT 1 FROM users WHERE pass = $2', ['secret-value', CRYPTO_KEY], client);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const [, meta] = loggerWarn.mock.calls[0];
    expect(meta.params).toContain('secret-value');
    expect(meta.params).not.toContain(CRYPTO_KEY);
    expect(meta.params).toContain('[REDACTED]');
  });
});

describe('pool.query error logging', () => {
  it('redacts the key from params on error', async () => {
    const { query } = await loadPool();
    const client = { query: vi.fn().mockRejectedValue(new Error('boom')) };

    await expect(query('SELECT 1', [CRYPTO_KEY, 'other'], client)).rejects.toThrow('boom');

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [, meta] = loggerError.mock.calls[0];
    expect(meta.params).not.toContain(CRYPTO_KEY);
    expect(meta.params).toContain('[REDACTED]');
    expect(meta.params).toContain('"other"');
  });
});
