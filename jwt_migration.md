# JWT Migration Report — HS256 → RS256

**Status:** ✅ Complete (implementation verified in-place)
**Date:** 2026-08-09
**Verification:** 722/722 server tests, 6/6 client tests, client build green, live auth-flow run passed end-to-end.

---

## 1. Executive summary

The authentication system signs access tokens with **RS256** using a 2048-bit RSA key
pair. All verification — REST middleware, every Socket.io namespace, and the shared
socket auth — **explicitly pins `algorithms: ['RS256']`** and enforces issuer/audience.
There are **zero remaining references** to `JWT_SECRET` or `HS256` anywhere in the
repository (code, env files, docs, tests, scripts, workers).

This report records the migration, the security review, and the verification performed.

---

## 2. Architecture changes (before → after)

| Concern | Before (HS256) | After (RS256) |
|---|---|---|
| Signing | Symmetric `JWT_SECRET` | **Asymmetric** RSA private key |
| Verification | Symmetric `JWT_SECRET` | RSA **public** key |
| Key strength | Shared secret (variable length) | **2048-bit RSA** (PKCS#8 / SPKI PEM) |
| Key storage | Env string | **PEM files on disk**, paths via env |
| Key distribution | Same secret everywhere (sign + verify share it) | Private key **never** distributed; only public key shipped to verifiers |
| Algorithm pinning | — | `algorithms: ['RS256']` on **every** `jwt.verify` |
| Issuer / audience | — | `iss: hms`, `aud: hms-client` enforced on verify |
| Algorithm-confusion resistance | N/A | HS256 tokens rejected (`invalid algorithm` → 401) |
| Refresh tokens | Opaque, Redis-backed | **Unchanged** — opaque `crypto.randomBytes(48)` token in Redis, single-use rotation |
| Revocation | Redis + DB `sessions` | **Unchanged** — per-request DB check + Redis refresh deletion |

Key locations:

| Purpose | File |
|---|---|
| Signing (login / 2FA / refresh issuance) | `server/src/modules/auth/auth.service.js:178-183` |
| REST verify | `server/src/shared/middleware/auth.js:44-48` |
| Socket.io verify (shared) | `server/src/socket.js:26-30` |
| Socket.io verify (messaging) | `server/src/modules/messaging/messaging.socket.js:23-27` |
| Socket.io verify (notifications) | `server/src/modules/notifications/notification.socket.js:15-19` |
| Socket.io verify (telemedicine) | `server/src/modules/telemedicine/telemedicine.socket.js:18-22` |
| Env contract | `server/src/app.js:57-68` (required env), `server/.env`, `server/.env.example:59-63` |
| Key material | `server/keys/private.pem`, `server/keys/public.pem` (**gitignored**) |

---

## 3. JWT usage inventory (sign / verify / refresh / revoke / decode)

| Operation | Location | Algorithm | Notes |
|---|---|---|---|
| **Sign** access token | `auth.service.js:178` | `RS256` | `expiresIn: 15m`, `issuer`, `audience` |
| **Verify** (REST) | `shared/middleware/auth.js:44` | `RS256` | `algorithms:['RS256']`, iss/aud, session DB check |
| **Verify** (socket shared) | `socket.js:26` | `RS256` | iss/aud enforced |
| **Verify** (messaging socket) | `messaging.socket.js:23` | `RS256` | iss/aud enforced |
| **Verify** (notification socket) | `notification.socket.js:15` | `RS256` | iss/aud enforced |
| **Verify** (telemedicine socket) | `telemedicine.socket.js:18` | `RS256` | iss/aud enforced |
| **Refresh** | `auth.service.js:196-235` | n/a (opaque) | Redis single-use rotation, re-issues RS256 pair |
| **Revoke** (logout) | `auth.service.js:240-245`, controller `logoutHandler` | n/a | Deletes Redis refresh token; clears HttpOnly cookie |
| **Revoke** (session) | `auth.service.js getSessions/revoke*` | n/a | DB `sessions.revoked_at` — re-checked every request |
| **Decode** (client) | `client/src/shared/utils/crypto.js:267` | n/a | Base64 decode of payload only — **no verification**, no security reliance |

No background worker verifies JWTs: `server/src/shared/jobs/*` only flushes refresh
tokens (Redis) and never parses tokens.

---

## 4. Updated code (RS256 reference implementations)

### 4.1 Signing — `server/src/modules/auth/auth.service.js`

```js
import fs from 'fs';

// Key loading — RS256 key pair from env-specified paths
const PRIVATE_KEY = fs.readFileSync(process.env.JWT_PRIVATE_KEY_PATH, 'utf8');
const PUBLIC_KEY  = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH,  'utf8');

const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes (seconds)

export async function issueTokenPair(user, sessionId = null) {
  const payload = {
    sub:          user.id,
    roles,
    departmentId: user.department_id,
    firstName:    user.first_name,
    lastName:     user.last_name,
    ...(sessionId && { sessionId }),
  };

  const accessToken = jwt.sign(payload, PRIVATE_KEY, {
    algorithm : 'RS256',
    expiresIn : ACCESS_TOKEN_TTL,
    issuer    : process.env.JWT_ISSUER || 'hms',
    audience  : process.env.JWT_AUDIENCE || 'hms-client',
  });
  ...
}
```

### 4.2 Verification (REST) — `server/src/shared/middleware/auth.js`

```js
payload = jwt.verify(token, PUBLIC_KEY, {
  algorithms: ['RS256'],
  issuer    : process.env.JWT_ISSUER   || 'hms',
  audience  : process.env.JWT_AUDIENCE || 'hms-client',
});
```

> `PUBLIC_KEY` is exported from `auth.service.js` and imported here (and in the socket
> files) so the key material is loaded once.

### 4.3 Verification (Socket.io) — `server/src/socket.js`, `messaging.socket.js`, `notification.socket.js`, `telemedicine.socket.js`

All four verify with identical options:

```js
const PUBLIC_KEY = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
...
const payload = jwt.verify(token, PUBLIC_KEY, {
  algorithms: ['RS256'],
  issuer    : process.env.JWT_ISSUER   || 'hms',
  audience  : process.env.JWT_AUDIENCE || 'hms-client',
});
```

### 4.4 Environment — `server/.env` and `server/.env.example`

```ini
# ── JWT (RS256) ───────────────────────────────────────────────
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
JWT_ISSUER=hms
JWT_AUDIENCE=hms-client
```

Startup fails fast if `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` are unset
(`server/src/app.js:57-68`). `JWT_SECRET` has been removed from `.env`, `.env.example`,
and all code.

---

## 5. Security review (requirement 8)

| Check | Result |
|---|---|
| **Algorithm-confusion attack** | ✅ Blocked — every `jwt.verify` pins `algorithms: ['RS256']`. A forged HS256 token signed with the public key returns **401 `Invalid token`** (verified live). |
| **Key exposure risk** | ✅ Private key `server/keys/` is **gitignored** (`*.pem`, `server/keys/`); only the public key is used by verifiers. Private key never leaves the signing server. |
| **Weak key sizes** | ✅ **2048-bit RSA** (verified with `openssl rsa -text`; `Private-Key: (2048 bit, 2 primes)`). |
| **Improper verification logic** | ✅ `jsonwebtoken@^9.0.3` (v9 rejects tokens unless `algorithms` is supplied for asymmetric keys); all 6 verify sites specify it. |
| **Missing issuer/audience** | ✅ `iss`/`aud` enforced on all verify sites. |
| **Refresh-token strength** | ✅ 384-bit opaque token (`crypto.randomBytes(48)`), single-use rotation, Redis TTL 7 days. |
| **Revocation strength** | ✅ Access tokens are re-checked against `sessions.revoked_at` **on every request** (fail-closed: DB error → 503); logout deletes the refresh token immediately. |
| **JWT_SECRET residue** | ✅ `grep -r JWT_SECRET` and `HS256` → **0 matches** repo-wide (excl. `node_modules`/`dist`). |

---

## 6. Verification performed

### 6.1 Automated tests
- **Server:** `npm test` → **57 files, 722/722 passed** (includes the RS256-based
  `auth.middleware.test.js`, which generates its own 2048-bit RSA pair and signs with
  `algorithm: 'RS256'`).
- **Client:** `npm test` → **6/6 passed**; `npm run build` → success.

### 6.2 Live auth-flow run (requirement 10)
Performed against the running backend, mirroring the exact browser flow:

| Step | Result |
|---|---|
| 1. Login (username + password) | HTTP 200 → `requires2fa` |
| 2. 2FA verify (OTP from Redis) | HTTP 200 → **RS256 access token issued** |
| 3. JWT header | `alg: RS256`, `typ: JWT` |
| 4. Signature + claims | Verified with public key; `iss=hms`, `aud=hms-client`, `sessionId` present, roles `["SUPER_ADMIN"]` |
| 5. Protected API access | `GET /api/admin/stats` → **HTTP 200** |
| 6. Token refresh | HTTP 200 → new access token, header `alg: RS256`, verified with public key |
| 7. Protected API (post-refresh) | **HTTP 200** |
| 8. Logout | HTTP 200; refresh token deleted from Redis |
| 9. Refresh after logout | **HTTP 401** (correctly rejected) |
| 10. Session revocation (DB) | Revoked session → previously-valid access token → **HTTP 401 `Session revoked`** |
| 11. HS256 attack | Forged HS256 token signed with the public key → **HTTP 401 `Invalid token`** |

---

## 7. Backward-compatibility concerns

- **Old HS256 tokens are immediately invalid.** There is no algorithm fallback, so any
  previously issued HS256 tokens fail verification with `invalid algorithm`. This is
  intentional (never accept a weaker algorithm); the only remediation is re-login.
- **No downtime required at deploy time** as long as `JWT_PRIVATE_KEY_PATH` /
  `JWT_PUBLIC_KEY_PATH` point to a valid pair on the server and `server/keys/` exists.
- The **client is unaffected**: it never signs or verifies; it only base64-decodes the
  payload for UI purposes. Tokens are transported identically (`Authorization: Bearer`).
- **Refresh/revocation/2FA/RBAC/audit/zero-trust middleware are algorithm-agnostic** and
  unchanged. RBAC reads `req.user.roles` populated by `authenticate`; the session
  revocation re-check is per-request and orthogonal to the signing algorithm.

---

## 8. Key rotation strategy (future)

The current layout supports rotation with a restart:

1. Generate a new pair, e.g.
   `openssl genrsa -out keys/private.pem 3072` (or `4096`) + `openssl rsa -in keys/private.pem -pubout -out keys/public.pem`.
2. Swap files under `server/keys/` and restart `node src/app.js` — the public key is
   loaded once at startup in `auth.service.js` and the socket modules.

**Recommendation for zero-downtime rotation:** add a `kid` header and keep the previous
public key in a short-lived "accept window". Concretely:
- Sign with `kid: 'v2'`; verify with `algorithms: ['RS256']` and accept any `kid` in a
  small map `{ v1: oldPublic, v2: currentPublic }`.
- Add the previous key to the map for one access-token TTL (15 min) after rotating, then
  drop it. This is a small, isolated change to `auth.service.js` + a shared key module.
- Store key material in a KMS/secret manager in production instead of files if
  compliance requires it; the load path (`process.env.JWT_PRIVATE_KEY_PATH`) is the only
  touchpoint to change.

---

## 9. Remaining risks

| Risk | Severity | Mitigation |
|---|---|---|
| Key files on disk (not HSM/KMS) | Low | 2048-bit RSA, file perms, gitignored; swap for KMS when available |
| No `kid` rotation mechanism yet | Low | Documented strategy in §8 |
| `jwt.decode` on client trusts payload | Info | UI-only; never used for authorization decisions |
| Server restart required to pick up new keys | Low | Planned; acceptable for this deployment |

---

## 10. Testing instructions

```bash
# Server suite (722 tests — includes RS256 auth.middleware.test.js)
cd server && npm test

# Client unit tests + build
cd client && npm test && npm run build

# Manual flow (requires running server on :5000 with a valid key pair)
# 1. GET  /api/auth/csrf-token
# 2. POST /api/auth/login                → requires2fa
# 3. POST /api/auth/2fa/verify           → accessToken (decode header: alg=RS256)
# 4. GET  /api/admin/stats  (Bearer)     → 200
# 5. POST /api/auth/refresh (cookie)     → new RS256 accessToken
# 6. POST /api/auth/logout  (cookie)     → refresh afterwards returns 401
# 7. Revoke the session in DB            → access token returns 401 "Session revoked"
```
