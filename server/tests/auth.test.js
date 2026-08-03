// Coverage for auth.service.js: login, token pairs, refresh rotation,
// OTP change-password, sessions, and 2FA flows.

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, redis, argonVerify, argonHash, jwtSign,
  sendOTPMock, notifMock, tempPassMock, baseTemplateMock, pgDecrypt,
} = vi.hoisted(() => ({
  q: vi.fn(),
  redis: {
    incr : vi.fn(), expire: vi.fn(), ttl: vi.fn(), del: vi.fn(),
    setex: vi.fn(), get: vi.fn(), keys: vi.fn(),
  },
  argonVerify: vi.fn(),
  argonHash: vi.fn(),
  jwtSign: vi.fn(),
  sendOTPMock: vi.fn(),
  notifMock: vi.fn(),
  tempPassMock: vi.fn(),
  baseTemplateMock: vi.fn(() => '<html></html>'),
  pgDecrypt: vi.fn(async (user) => ({ ...user, email: 'locked@hms.test' })),
}));

vi.mock('../src/shared/db/pool.js', () => ({ pool: { query: q } }));
vi.mock('../src/shared/services/redis.service.js', () => ({ redis }));
vi.mock('../src/shared/db/pgcrypto.js', () => ({ pgDecryptFields: pgDecrypt }));
vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('argon2', () => ({
  default: { verify: argonVerify, hash: argonHash, argon2id: 'argon2id' },
  verify: argonVerify, hash: argonHash, argon2id: 'argon2id',
}));
vi.mock('jsonwebtoken', () => ({
  default: { sign: jwtSign, verify: vi.fn() },
  sign: jwtSign, verify: vi.fn(),
}));
vi.mock('../src/shared/services/email.service.js', () => ({
  sendOTP            : sendOTPMock,
  sendNotification   : notifMock,
  sendTempPassword   : tempPassMock,
  baseTemplate       : baseTemplateMock,
  tempPasswordTemplate: vi.fn(() => ''),
  otpTemplate        : vi.fn(() => ''),
}));

// ---------------------------------------------------------------------------
// auth.service.js reads the key files at import time — prepare them first,
// then load the module dynamically (same pattern as auth.middleware.test.js).
// ---------------------------------------------------------------------------
const KEY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-keys-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding : { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
fs.writeFileSync(path.join(KEY_DIR, 'private.pem'), privateKey);
fs.writeFileSync(path.join(KEY_DIR, 'public.pem'),  publicKey);

process.env.JWT_PRIVATE_KEY_PATH = path.join(KEY_DIR, 'private.pem');
process.env.JWT_PUBLIC_KEY_PATH  = path.join(KEY_DIR, 'public.pem');
process.env.JWT_ISSUER           = 'hms';
process.env.JWT_AUDIENCE         = 'hms-client';
process.env.PG_CRYPTO_KEY        = 'test-crypto-key';
process.env.NODE_ENV             = 'test';
process.env.SUPER_ADMIN_EMAIL    = 'superadmin@hms.test';
process.env.HOSPITAL_NAME        = 'Test Hospital';

const auth = await import('../src/modules/auth/auth.service.js');

afterAll(() => {
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
  for (const k of [
    'JWT_PRIVATE_KEY_PATH', 'JWT_PUBLIC_KEY_PATH', 'JWT_ISSUER',
    'JWT_AUDIENCE', 'PG_CRYPTO_KEY', 'SUPER_ADMIN_EMAIL', 'HOSPITAL_NAME',
  ]) delete process.env[k];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function userRow(overrides = {}) {
  return {
    id: 'u1', password_hash: 'hash', is_active: true, must_change_password: false,
    first_name: 'Alice', last_name: 'Smith', department_id: 'd1',
    twofa_enabled: false, email: 'alice@hms.test', roles: '{DOCTOR}',
    ...overrides,
  };
}

function loginUserRow(overrides = {}) {
  // shape returned by getUserByUsername (includes password_hash + twofa_enabled)
  return userRow(overrides);
}

function activeUserRow(overrides = {}) {
  // shape returned by the refresh/verifyTwoFaLogin user query (no email/twofa)
  return {
    id: 'u1', is_active: true, first_name: 'Alice', last_name: 'Smith',
    department_id: 'd1', roles: '{DOCTOR}', ...overrides,
  };
}

const refreshToken = 'a'.repeat(96);

// resetAllMocks (not clearAllMocks) also clears once-queues + implementations,
// preventing mock state leaking between tests.
beforeEach(() => {
  vi.resetAllMocks();
  argonVerify.mockResolvedValue(true);
  jwtSign.mockReturnValue('access-token');
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------
describe('auth.service — login', () => {
  it('rate-limits after MAX_LOGIN_ATTEMPTS (429)', async () => {
    redis.incr.mockResolvedValue(6);
    redis.ttl.mockResolvedValue(600);
    await expect(auth.login('alice', 'pw', '1.2.3.4')).rejects.toMatchObject({ status: 429 });
    expect(redis.incr).toHaveBeenCalled();
  });

  it('rejects unknown users with 401', async () => {
    redis.incr.mockResolvedValue(1);
    q.mockResolvedValueOnce({ rows: [] });
    await expect(auth.login('ghost', 'pw', '1.2.3.4'))
      .rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
  });

  it('rejects a wrong password with 401', async () => {
    redis.incr.mockResolvedValue(1);
    q.mockResolvedValueOnce({ rows: [loginUserRow()] });
    argonVerify.mockResolvedValue(false);
    await expect(auth.login('alice', 'wrong', '1.2.3.4'))
      .rejects.toMatchObject({ status: 401 });
  });

  it('rejects disabled accounts with 403', async () => {
    redis.incr.mockResolvedValue(1);
    q.mockResolvedValueOnce({ rows: [loginUserRow({ is_active: false })] });
    await expect(auth.login('alice', 'pw', '1.2.3.4'))
      .rejects.toMatchObject({ status: 403, message: 'Account is disabled' });
  });

  it('returns mustChangePassword without issuing tokens', async () => {
    redis.incr.mockResolvedValue(1);
    q.mockResolvedValueOnce({ rows: [loginUserRow({ must_change_password: true })] });
    const res = await auth.login('alice', 'pw', '1.2.3.4');
    expect(res).toEqual({ mustChangePassword: true });
    expect(redis.del).toHaveBeenCalled();
    expect(jwtSign).not.toHaveBeenCalled();
  });

  it('returns requires2fa when 2FA is enabled', async () => {
    redis.incr.mockResolvedValue(1);
    q.mockResolvedValueOnce({ rows: [loginUserRow({ twofa_enabled: true })] });
    const res = await auth.login('alice', 'pw', '1.2.3.4');
    expect(res.requires2fa).toBe(true);
    expect(res.userId).toBe('u1');
    expect(redis.setex).toHaveBeenCalledWith('2fa_otp:u1', expect.any(Number), expect.stringMatching(/^\d{6}$/));
    expect(redis.setex).toHaveBeenCalledWith('2fa_pending:u1', expect.any(Number), '1');
    expect(sendOTPMock).toHaveBeenCalledWith('alice@hms.test', expect.stringMatching(/^\d{6}$/));
  });

  it('succeeds: issues session + token pair, clears attempt counter', async () => {
    redis.incr.mockResolvedValue(1);
    q.mockResolvedValueOnce({ rows: [loginUserRow()] });              // getUserByUsername
    q.mockResolvedValueOnce({ rows: [] });                            // UPDATE last_login_at
    q.mockResolvedValueOnce({ rows: [{ id: 's1' }] });                // INSERT session

    const res = await auth.login('alice', 'pw', '1.2.3.4', 'Chrome');

    expect(redis.expire).toHaveBeenCalledWith(expect.stringContaining('login_attempts:'), 900);
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('login_attempts:'));
    expect(res.user).toEqual({ id: 'u1', firstName: 'Alice', lastName: 'Smith', roles: ['DOCTOR'], departmentId: 'd1' });
    expect(res.refreshToken).toMatch(/^[a-f0-9]{96}$/);
    expect(res.accessToken).toBe('access-token');
    // session insert carried the hashed IP/UA
    const sessionInsert = q.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO sessions'));
    expect(sessionInsert[1]).toEqual(['u1', expect.stringMatching(/^[a-f0-9]{16}$/), expect.stringMatching(/^[a-f0-9]{16}$/), expect.any(Date)]);
    // token pair bound to the session
    expect(jwtSign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', roles: ['DOCTOR'], sessionId: 's1' }),
      expect.any(String),
      expect.objectContaining({ algorithm: 'RS256', issuer: 'hms', audience: 'hms-client' })
    );
    expect(redis.setex).toHaveBeenCalledWith(`refresh:${res.refreshToken}`, 604800, expect.stringContaining('"sessionId":"s1"'));
  });
});

// ---------------------------------------------------------------------------
// issueTokenPair
// ---------------------------------------------------------------------------
describe('auth.service — issueTokenPair', () => {
  it('normalizes string roles and attaches sessionId', async () => {
    const tokens = await auth.issueTokenPair({ id: 'u1', roles: '{ADMIN,NURSE}', department_id: 'd1', first_name: 'A', last_name: 'B' }, 's9');
    expect(jwtSign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', roles: ['ADMIN', 'NURSE'], sessionId: 's9' }),
      expect.any(String),
      expect.any(Object)
    );
    expect(redis.setex).toHaveBeenCalledWith(
      `refresh:${tokens.refreshToken}`, 604800,
      JSON.stringify({ userId: 'u1', sessionId: 's9' })
    );
  });

  it('passes array roles through and omits sessionId when absent', async () => {
    await auth.issueTokenPair({ id: 'u1', roles: ['DOCTOR'], department_id: null, first_name: 'A', last_name: 'B' });
    expect(jwtSign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', roles: ['DOCTOR'] }),
      expect.any(String),
      expect.not.objectContaining({ sessionId: expect.anything() })
    );
  });
});

// ---------------------------------------------------------------------------
// refresh — single-use rotation
// ---------------------------------------------------------------------------
describe('auth.service — refresh', () => {
  it('rejects a missing token (401)', async () => {
    await expect(auth.refresh()).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an unknown/expired token (401)', async () => {
    redis.get.mockResolvedValue(null);
    await expect(auth.refresh(refreshToken)).rejects.toMatchObject({ status: 401, message: 'Invalid or expired refresh token' });
  });

  it('rotates: deletes the old token, issues a new pair', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ userId: 'u1', sessionId: 's1' }));
    q.mockResolvedValueOnce({ rows: [activeUserRow()] });

    const tokens = await auth.refresh(refreshToken);

    expect(redis.del).toHaveBeenCalledWith(`refresh:${refreshToken}`); // single-use
    expect(jwtSign).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), expect.any(String), expect.any(Object));
    expect(tokens.accessToken).toBe('access-token');
    expect(tokens.refreshToken).toMatch(/^[a-f0-9]{96}$/);
    expect(redis.setex).toHaveBeenCalled();
  });

  it('rejects inactive users after token is consumed (401)', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ userId: 'u1', sessionId: 's1' }));
    q.mockResolvedValueOnce({ rows: [activeUserRow({ is_active: false })] });
    await expect(auth.refresh(refreshToken)).rejects.toMatchObject({ status: 401, message: 'User not found or inactive' });
  });

  it('detects refresh-token theft: a replayed (already-consumed) token is rejected', async () => {
    // Redis is the single source of truth for refresh tokens. Simulate it as an
    // in-memory store so a successful refresh genuinely invalidates the old token.
    const store = new Map();
    redis.get.mockImplementation(async (k) => store.get(k) ?? null);
    redis.del.mockImplementation(async (k) => { store.delete(k); return 1; });
    redis.setex.mockImplementation(async (k, _ttl, v) => { store.set(k, v); return 'OK'; });

    // Phase 1 — log in, capture the refresh token as an attacker would.
    redis.incr.mockResolvedValue(1);
    q.mockReset();
    q.mockResolvedValueOnce({ rows: [loginUserRow()] });   // getUserByUsername
    q.mockResolvedValueOnce({ rows: [] });                 // UPDATE last_login_at
    q.mockResolvedValueOnce({ rows: [{ id: 's1' }] });     // INSERT session
    const loginRes = await auth.login('alice', 'pw', '1.2.3.4', 'Chrome');
    const stolen = loginRes.refreshToken;
    expect(store.has(`refresh:${stolen}`)).toBe(true);

    // Phase 2 — first refresh with the stolen token succeeds AND consumes it.
    q.mockReset();
    q.mockResolvedValue({ rows: [activeUserRow()] });
    const first = await auth.refresh(stolen);
    expect(first.accessToken).toBe('access-token');
    expect(store.has(`refresh:${stolen}`)).toBe(false); // single-use: consumed

    // Phase 3 — replaying the SAME old token is rejected (theft is detected).
    await expect(auth.refresh(stolen)).rejects.toMatchObject({
      status : 401,
      message: 'Invalid or expired refresh token',
    });

    // Phase 4 — the rotated token still works for the legitimate device.
    const second = await auth.refresh(first.refreshToken);
    expect(second.accessToken).toBe('access-token');
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------
describe('auth.service — logout', () => {
  it('deletes the refresh token from redis', async () => {
    await auth.logout(refreshToken);
    expect(redis.del).toHaveBeenCalledWith(`refresh:${refreshToken}`);
  });

  it('is a no-op without a token', async () => {
    await auth.logout();
    expect(redis.del).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requestOtp / changePassword
// ---------------------------------------------------------------------------
describe('auth.service — OTP change password', () => {
  it('requestOtp silently returns when the user is unknown', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(auth.requestOtp('ghost')).resolves.toBeUndefined();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('requestOtp stores a 6-digit OTP and emails it', async () => {
    q.mockResolvedValueOnce({ rows: [loginUserRow()] });
    await auth.requestOtp('alice');
    expect(redis.setex).toHaveBeenCalledWith('otp:u1', 600, expect.stringMatching(/^\d{6}$/));
    expect(sendOTPMock).toHaveBeenCalledWith('alice@hms.test', expect.stringMatching(/^\d{6}$/));
  });

  it('changePassword → 404 when user is unknown', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(auth.changePassword('ghost', '123456', 'newPass')).rejects.toMatchObject({ status: 404 });
  });

  it('changePassword rejects an invalid/expired OTP (400)', async () => {
    q.mockResolvedValueOnce({ rows: [loginUserRow()] });
    redis.get.mockResolvedValue('999999');
    await expect(auth.changePassword('alice', '123456', 'newPass')).rejects.toMatchObject({ status: 400, message: 'Invalid or expired OTP' });
  });

  it('changePassword rehashes and clears must_change_password on success', async () => {
    q.mockResolvedValueOnce({ rows: [loginUserRow()] });
    q.mockResolvedValueOnce({ rows: [] });
    redis.get.mockResolvedValue('123456');
    argonHash.mockResolvedValue('new-hash');

    const res = await auth.changePassword('alice', '123456', 'newPass');

    expect(res).toEqual({ success: true });
    expect(redis.del).toHaveBeenCalledWith('otp:u1');
    expect(argonHash).toHaveBeenCalledWith('newPass', expect.objectContaining({ type: 'argon2id' }));
    const update = q.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'));
    expect(update[1]).toEqual(['new-hash', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// flushAllRefreshTokens / sessions
// ---------------------------------------------------------------------------
describe('auth.service — session management', () => {
  it('flushAllRefreshTokens deletes every refresh key', async () => {
    redis.keys.mockResolvedValue(['refresh:a', 'refresh:b']);
    await auth.flushAllRefreshTokens();
    expect(redis.del).toHaveBeenCalledWith('refresh:a', 'refresh:b');
  });

  it('flushAllRefreshTokens skips when there are no keys', async () => {
    redis.keys.mockResolvedValue([]);
    await auth.flushAllRefreshTokens();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('getSessions returns active sessions', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 's1' }] });
    expect(await auth.getSessions('u1')).toEqual([{ id: 's1' }]);
    expect(q.mock.calls[0][0]).toContain('revoked_at IS NULL');
  });

  it('revokeSession revokes the session row and its refresh token', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    redis.keys.mockResolvedValue(['refresh:a', 'refresh:b']);
    redis.get.mockResolvedValueOnce(JSON.stringify({ sessionId: 's1' }));
    await auth.revokeSession('s1', 'u1');
    expect(q.mock.calls[0][0]).toContain('SET revoked_at = NOW()');
    expect(redis.del).toHaveBeenCalledWith('refresh:a'); // break after first match
    expect(redis.del).not.toHaveBeenCalledWith('refresh:b');
  });

  it('revokeSession ignores non-matching or unparseable tokens', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    redis.keys.mockResolvedValue(['refresh:a', 'refresh:b']);
    redis.get.mockResolvedValueOnce(JSON.stringify({ sessionId: 'other' }));
    redis.get.mockResolvedValueOnce('not-json');
    await auth.revokeSession('s1', 'u1');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('revokeAllOtherSessions revokes rows and deletes other refresh tokens', async () => {
    q.mockResolvedValueOnce({ rowCount: 2 });
    redis.keys.mockResolvedValue(['r1', 'r2', 'r3']);
    redis.get
      .mockResolvedValueOnce(JSON.stringify({ sessionId: 's1' }))
      .mockResolvedValueOnce(JSON.stringify({ sessionId: 's2' }))
      .mockResolvedValueOnce(JSON.stringify({ sessionId: 's3' }));
    const count = await auth.revokeAllOtherSessions('s1', 'u1');
    expect(count).toBe(2);
    expect(redis.del).toHaveBeenCalledWith('r2', 'r3');
  });

  it('revokeSession still revokes the DB row when Redis is down (best-effort cleanup)', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    redis.keys.mockRejectedValue(new Error('ECONNREFUSED'));

    await auth.revokeSession('s1', 'u1');

    expect(q.mock.calls[0][0]).toContain('SET revoked_at = NOW()');
  });

  it('revokeAllOtherSessions still returns rowCount when Redis is down (best-effort cleanup)', async () => {
    q.mockResolvedValueOnce({ rowCount: 2 });
    redis.keys.mockRejectedValue(new Error('ECONNREFUSED'));

    const count = await auth.revokeAllOtherSessions('s1', 'u1');

    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2FA
// ---------------------------------------------------------------------------
describe('auth.service — 2FA', () => {
  it('getTwoFaStatus returns enabled state / 404', async () => {
    q.mockResolvedValueOnce({ rows: [{ twofa_enabled: true }] });
    expect(await auth.getTwoFaStatus('u1')).toEqual({ enabled: true });
    q.mockResolvedValueOnce({ rows: [] });
    await expect(auth.getTwoFaStatus('u1')).rejects.toMatchObject({ status: 404 });
  });

  it('requestTwoFaEnable → 404 / 409 / sends OTP', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(auth.requestTwoFaEnable('u1')).rejects.toMatchObject({ status: 404 });

    q.mockResolvedValueOnce({ rows: [{ twofa_enabled: true }] });
    await expect(auth.requestTwoFaEnable('u1')).rejects.toMatchObject({ status: 409, message: '2FA is already enabled' });

    q.mockResolvedValueOnce({ rows: [{ twofa_enabled: false, email: 'alice@hms.test' }] });
    await auth.requestTwoFaEnable('u1');
    expect(redis.setex).toHaveBeenCalledWith('2fa_otp:u1', 600, expect.stringMatching(/^\d{6}$/));
    expect(sendOTPMock).toHaveBeenCalledWith('alice@hms.test', expect.stringMatching(/^\d{6}$/));
  });

  it('confirmTwoFaEnable rejects a bad OTP and enables on success', async () => {
    redis.get.mockResolvedValue('000000');
    await expect(auth.confirmTwoFaEnable('u1', '111111')).rejects.toMatchObject({ status: 400 });

    redis.get.mockResolvedValue('123456');
    q.mockResolvedValueOnce({ rows: [] });
    await auth.confirmTwoFaEnable('u1', '123456');
    expect(redis.del).toHaveBeenCalledWith('2fa_otp:u1');
    const update = q.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'));
    expect(update[0]).toContain('twofa_enabled = TRUE');
  });

  it('requestTwoFaDisable → 404 / 409 / sends OTP', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(auth.requestTwoFaDisable('u1')).rejects.toMatchObject({ status: 404 });

    q.mockResolvedValueOnce({ rows: [{ twofa_enabled: false }] });
    await expect(auth.requestTwoFaDisable('u1')).rejects.toMatchObject({ status: 409, message: '2FA is not enabled' });

    q.mockResolvedValueOnce({ rows: [{ twofa_enabled: true, email: 'alice@hms.test' }] });
    await auth.requestTwoFaDisable('u1');
    expect(redis.setex).toHaveBeenCalledWith('2fa_otp:u1', 600, expect.stringMatching(/^\d{6}$/));
  });

  it('confirmTwoFaDisable rejects a bad OTP and disables on success', async () => {
    redis.get.mockResolvedValue(null);
    await expect(auth.confirmTwoFaDisable('u1', '123456')).rejects.toMatchObject({ status: 400 });

    redis.get.mockResolvedValue('123456');
    q.mockResolvedValueOnce({ rows: [] });
    await auth.confirmTwoFaDisable('u1', '123456');
    const update = q.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'));
    expect(update[0]).toContain('twofa_enabled = FALSE');
  });

  it('sendTwoFaLoginOtp stores otp + pending marker and emails', async () => {
    await auth.sendTwoFaLoginOtp('u1', 'alice@hms.test');
    expect(redis.setex).toHaveBeenCalledWith('2fa_otp:u1', 600, expect.stringMatching(/^\d{6}$/));
    expect(redis.setex).toHaveBeenCalledWith('2fa_pending:u1', 600, '1');
    expect(sendOTPMock).toHaveBeenCalledWith('alice@hms.test', expect.stringMatching(/^\d{6}$/));
  });

  it('verifyTwoFaLogin → 400 when there is no pending login', async () => {
    redis.get.mockResolvedValue(null);
    await expect(auth.verifyTwoFaLogin('u1', '123456', 'ip', 'ua')).rejects
      .toMatchObject({ status: 400, message: expect.stringMatching(/No pending 2FA session/) });
  });

  it('verifyTwoFaLogin rejects a wrong OTP (400)', async () => {
    redis.get.mockResolvedValueOnce('1').mockResolvedValueOnce('999999');
    await expect(auth.verifyTwoFaLogin('u1', '123456', 'ip', 'ua')).rejects.toMatchObject({ status: 400 });
  });

  it('verifyTwoFaLogin completes the login and issues tokens', async () => {
    redis.get.mockResolvedValueOnce('1').mockResolvedValueOnce('123456');
    q.mockResolvedValueOnce({ rows: [activeUserRow()] });   // fetch user
    q.mockResolvedValueOnce({ rows: [] });                  // UPDATE last_login_at
    q.mockResolvedValueOnce({ rows: [{ id: 's2' }] });      // INSERT session
    jwtSign.mockReturnValue('access-token');

    const res = await auth.verifyTwoFaLogin('u1', '123456', '1.1.1.1', 'FF');

    expect(redis.del).toHaveBeenCalledWith('2fa_otp:u1');
    expect(redis.del).toHaveBeenCalledWith('2fa_pending:u1');
    expect(jwtSign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1', sessionId: 's2' }), expect.any(String), expect.any(Object));
    expect(res.accessToken).toBe('access-token');
    expect(res.user.roles).toEqual(['DOCTOR']);
  });
});
