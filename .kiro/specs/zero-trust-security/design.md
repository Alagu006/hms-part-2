# Design Document — Zero Trust Security Compliance

## Overview

This document describes the technical design for closing the nine security gaps identified in the Zero Trust audit of the City General Hospital Management System (HMS). The system already has strong foundations (RS256 JWT, Argon2id, CSRF protection, Redis rate limiting, SHA-256 audit log chain, Helmet.js, pgcrypto PII encryption). The changes below are surgical: each gap is fixed in isolation with minimal blast radius, preserving all existing behaviour.

**Rollout order (risk-ranked):**

| Priority | Gap | Rationale |
|---|---|---|
| 🔴 High | Gap 3 — Hardcoded default password | Credential exposure risk for every new account |
| 🔴 High | Gap 2 — CSPRNG everywhere | Predictable OTPs and encryption keys |
| 🔴 High | Gap 8 — Gemini API key in URL | Key leaks in every access log |
| 🟡 Medium | Gap 1 — Revoked-session detection | 15-minute window where revoked sessions remain valid |
| 🟡 Medium | Gap 6 — Billing route authorization | Wildcard access to financial records |
| 🟡 Medium | Gap 4 — Structured logging | No SIEM-ingestible audit trail for app events |
| 🟢 Low | Gap 5 — Security headers | Missing browser-enforcement headers |
| 🟢 Low | Gap 7 — Contact route validation | Public endpoint lacks schema validation |
| 🟢 Low | Gap 9 — Unused dependencies | Supply-chain surface area |

---

## Architecture

The HMS follows a layered Express architecture. All changes stay within the existing layer boundaries:

```
┌─────────────────────────────────────────────────────────┐
│  Client (React/Vite)                                    │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────┐
│  Express App (app.js)                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Middleware Pipeline                             │   │
│  │  1. Request ID                                   │   │
│  │  2. Helmet (Gap 5 ← add HSTS/RP/PP/COOP/CORP)   │   │
│  │  3. CORS                                         │   │
│  │  4. Rate Limiter (Gap 2 ← CSPRNG suffix)         │   │
│  │  5. IP Block                                     │   │
│  │  6. Audit Middleware                             │   │
│  │  7. Body Parser                                  │   │
│  │  8. CSRF                                         │   │
│  │  9. Sanitizer                                    │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Auth Middleware (Gap 1 ← session validation)    │   │
│  │  RBAC Middleware (Gap 6 ← billing roles)         │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Route Modules                                   │   │
│  │  billing.routes.js  (Gap 6)                      │   │
│  │  contact.routes.js  (Gap 7)                      │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Service Layer                                   │   │
│  │  auth.service.js    (Gap 2 — OTP CSPRNG)         │   │
│  │  admin.service.js   (Gap 3 — temp password)      │   │
│  │  messaging.service.js (Gap 2 — group key)        │   │
│  │  chatbot.service.js (Gap 8 — API key header)     │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Shared Infrastructure                           │   │
│  │  logger.js (Gap 4 — Winston, new file)           │   │
│  │  pool.js / redis.js                              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Components and Interfaces

### Gap 1 — Revoked-Session Detection

**File:** `server/src/shared/middleware/auth.js`

The current `authenticate` middleware verifies the RS256 JWT signature and expiry but does not check whether the embedded `sessionId` has been revoked in the `sessions` table. A force-logged-out session remains valid for up to 15 minutes (the JWT TTL).

**Change:** After successful JWT verification, add a DB lookup against `sessions` where `id = sessionId`. Reject with 401 if the row is missing or `revoked_at IS NOT NULL`. Reject with 503 on DB error (fail-closed).

**Session validation data flow:**

```
Request
  │
  ▼
JWT verify (RS256) ──fail──► 401 Invalid token
  │
  ▼
Extract sessionId ──missing──► 401 Missing session ID
  │
  ▼
DB: SELECT revoked_at FROM sessions WHERE id = $1
  │
  ├── DB error ──────────────► 503 Service unavailable
  ├── Row not found ──────────► 401 Session not found
  ├── revoked_at IS NOT NULL ──► 401 Session revoked
  └── revoked_at IS NULL ──────► next() ✓
```

**Interface change (auth.js):**

```js
// New import
import { pool } from '../../shared/db/pool.js';

export async function authenticate(req, res, next) {
  // ... existing JWT verify logic (unchanged) ...

  // After payload is decoded:
  const sessionId = payload.sessionId ?? null;
  if (!sessionId) {
    return res.status(401).json({ error: 'Missing session ID' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT revoked_at FROM sessions WHERE id = $1',
      [sessionId]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: 'Session not found' });
    }
    if (rows[0].revoked_at !== null) {
      return res.status(401).json({ error: 'Session revoked' });
    }
  } catch {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  req.user = { /* ... existing fields ... */ };
  next();
}
```

**Performance:** The `sessions.id` column is the primary key (UUID), so the lookup is a single indexed scan. Under normal load this completes well within the 50 ms budget. No Redis blocklist is needed for the initial implementation; if profiling shows the DB lookup is a bottleneck, a Redis TTL-based cache keyed on `sessionId` can be layered in without changing the interface.

---

### Gap 2 — CSPRNG Everywhere

**Files:** `auth.service.js`, `messaging.service.js`, `rateLimiter.js`, `billing.service.js`

Four `Math.random()` usages were found across the codebase:

| File | Usage | Replacement |
|---|---|---|
| `auth.service.js` | OTP generation | `crypto.randomInt(100000, 1000000)` |
| `messaging.service.js` | AES-256 group key | `crypto.randomBytes(32)` |
| `rateLimiter.js` | Sorted-set member suffix | `crypto.randomBytes(8).toString('hex')` |
| `billing.service.js` | Bill number suffix | `crypto.randomBytes(3).toString('hex').toUpperCase()` |

**Interface changes:**

```js
// auth.service.js — generateOtp()
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

// messaging.service.js — getOrCreateGroupKey()
const keyBytes = crypto.randomBytes(32);
const keyBase64 = keyBytes.toString('base64');

// rateLimiter.js — zadd member
multi.zadd(key, now, `${now}-${crypto.randomBytes(8).toString('hex')}`);

// billing.service.js — generateBillNumber()
const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
```

No API surface changes. All replacements are drop-in; the output format (string OTP, base64 key, hex suffix) is preserved.

---

### Gap 3 — Cryptographically Random Default Password

**File:** `server/src/modules/admin/admin.service.js`

The `createUser` function uses the hardcoded constant `'hospital@pass@12345'` as the initial password for every new staff account. This means a single leaked credential compromises all newly created accounts.

**Change:** Remove `DEFAULT_PASSWORD`. Generate a unique temporary password per account using `crypto.randomBytes(16).toString('base64url')` (22 characters, 128 bits of entropy). Pass the plaintext password to `sendTempPassword` and hash it with Argon2id as before. The `must_change_password = TRUE` flag is already set, so the force-change flow is unchanged.

**Interface change (createUser):**

```js
// Before
const DEFAULT_PASSWORD = 'hospital@pass@12345';

// After — no constant; generate inline
const tempPassword = crypto.randomBytes(16).toString('base64url');

const [emailEnc, phoneEnc, passwordHash] = await Promise.all([
  pgEncrypt(email),
  phone ? pgEncrypt(phone) : Promise.resolve(null),
  argon2.hash(tempPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 }),
]);

// ... later, in the fire-and-forget email call:
sendTempPassword(email, user.employee_id, tempPassword).catch(...)
```

The `createUser` return value gains a `tempPassword` field so the API response can surface it once to the admin who created the account:

```js
return { ...user, role, email, tempPassword };
```

The admin controller must include `tempPassword` in the HTTP 201 response body. This is the only time the plaintext password is ever transmitted.

---

### Gap 4 — Structured Logging (Winston)

**New file:** `server/src/shared/logger.js`  
**Modified:** `server/src/app.js` and all server files with `console.*` calls

Winston is already listed in `server/package.json`. A single logger instance is created and exported; all modules import it instead of using `console.*`.

**Logger configuration:**

```js
// server/src/shared/logger.js
import winston from 'winston';

const { combine, timestamp, json, colorize, simple } = winston.format;

const transports = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'development'
      ? combine(colorize(), simple())
      : combine(timestamp(), json()),
  }),
];

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'hms-server' },
  transports,
});
```

**Log entry schema (JSON, production):**

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "message": "LOGIN_SUCCESS",
  "service": "hms-server",
  "requestId": "uuid-v4",
  "userId": "uuid",
  "ip": "1.2.3.4",
  "event": "LOGIN_SUCCESS"
}
```

**Auth event logging** is added to `auth.service.js` at login success, login failure, logout, token refresh, and 2FA verify. Rate-limit logging is added to `rateLimiter.js`. The global error handler in `app.js` is updated to use `logger.error()` with `requestId`, `method`, `path`, `statusCode`, and `stack`.

**Replacement scope:** All `console.log`, `console.warn`, `console.error`, and `console.debug` calls in `server/src/**` are replaced. Dev-only `console.log` calls (e.g., OTP logging in non-production) are replaced with `logger.debug()`.

---

### Gap 5 — Security Headers

**File:** `server/src/app.js`

The existing `helmet()` call configures CSP but omits HSTS, Referrer-Policy, Permissions-Policy, COOP, and CORP. All five are added to the existing `helmet()` options object — no second middleware is installed.

**Updated Helmet config:**

```js
app.use(helmet({
  // Existing CSP (unchanged)
  contentSecurityPolicy: {
    directives: {
      defaultSrc : ["'self'"],
      scriptSrc  : ["'self'"],
      styleSrc   : ["'self'", "'unsafe-inline'"],
      imgSrc     : ["'self'", 'data:'],
      connectSrc : ["'self'", 'wss:'],
    },
  },

  // Gap 5 additions:
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,

  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  permissionsPolicy: {
    features: {
      camera      : [],
      microphone  : [],
      geolocation : [],
      payment     : [],
    },
  },

  crossOriginOpenerPolicy : { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));
```

HSTS is gated on `NODE_ENV === 'production'` to avoid breaking local HTTP development. The HTTP→HTTPS redirect (Requirement 4.6) is handled at the reverse-proxy/load-balancer level (nginx/ALB), not in Express, since `app.js` already sets `trust proxy: true`.

---

### Gap 6 — Billing Route Authorization

**File:** `server/src/modules/billing/billing.routes.js`

Three routes currently use `authorize('*')`, which allows any authenticated user — including `NURSE`, `DOCTOR`, `LAB_TECHNICIAN`, etc. — to access financial records.

**Routes to fix:**

| Route | Current | New |
|---|---|---|
| `GET /patient/:patientId` | `authorize('*')` | `authorize('PATIENT','BILLING','RECEPTIONIST','ADMIN','SUPER_ADMIN')` + `checkOwnership('patient')` for PATIENT |
| `GET /:id` | `authorize('*')` + `checkOwnership('bill')` | `authorize('PATIENT','BILLING','RECEPTIONIST','ADMIN','SUPER_ADMIN')` + `checkOwnership('bill')` |
| `PATCH /:id/pay` | `authorize('*')` | `authorize('PATIENT','BILLING','RECEPTIONIST','ADMIN','SUPER_ADMIN')` + `checkOwnership('bill')` for PATIENT |
| `GET /insurance/patient/:patientId` | `authorize('*')` | `authorize('PATIENT','BILLING','RECEPTIONIST','ADMIN','SUPER_ADMIN')` + `checkOwnership('patient')` for PATIENT |

The `checkOwnership` middleware already exists and handles the PATIENT-specific ownership check. The `authorize` call simply removes the wildcard and lists the explicit allowed roles.

**Design decision:** `checkOwnership` is applied unconditionally on the route. The middleware itself already skips the ownership check for non-PATIENT roles (it only enforces ownership when `req.user.roles` includes `'PATIENT'`), so no conditional logic is needed in the route definition.

---

### Gap 7 — Contact Route Validation

**File:** `server/src/modules/contact/contact.routes.js`

The current route uses hand-rolled validation. It is replaced with a Zod schema and a dedicated rate limiter.

**Zod schema:**

```js
import { z } from 'zod';

const CRLF_PATTERN = /[\r\n]/;

const contactSchema = z.object({
  name   : z.string().min(1).max(100),
  email  : z.string().email().max(254).refine(
    (v) => !CRLF_PATTERN.test(v),
    { message: 'Email must not contain newline characters' }
  ),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
});
```

**Dedicated rate limiter:**

```js
import { rateLimiter } from '../../shared/middleware/rateLimiter.js';

const contactRateLimiter = rateLimiter({
  windowSecs: 15 * 60,   // 15 minutes
  max       : 5,
  keyFn     : (req) => `contact:${req.ip}`,
});
```

The route handler is updated to call `contactSchema.safeParse(req.body)` and return HTTP 422 with the Zod error details on failure. The `escapeHtml` helper is retained for email body safety.

---

### Gap 8 — Gemini API Key in URL

**File:** `server/src/modules/chatbot/chatbot.service.js`

The `callGemini` function currently appends `?key=${apiKey}` to the URL. This exposes the key in server access logs, proxy logs, and any network inspection tool.

**Change:** Remove the query parameter. Pass the key as the `x-goog-api-key` request header. The URL becomes the clean model endpoint with no query string.

**Interface change:**

```js
async function callGemini(messages, systemPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  // No ?key= in URL
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type'  : 'application/json',
      'x-goog-api-key': apiKey,          // ← key moved here
    },
    body  : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  // ...
}
```

The key is never logged (the logger receives only the model name and response status). After this change is deployed, the user must rotate the Gemini API key in the environment configuration.

---

### Gap 9 — Unused Dependency Removal

**File:** `server/package.json`

Codebase-wide import search confirms:
- `bcrypt` — zero imports in `server/src/**`. Safe to remove. `argon2` is the sole password hashing library.
- `morgan` — zero imports in `server/src/**`. Safe to remove. HTTP request logging is handled by the audit middleware and (after Gap 4) the Winston structured logger.

**Change:** Remove both from `dependencies` in `package.json`, then run `npm install` to update `package-lock.json`.

---

## Data Models

### sessions table (existing, no schema change)

```sql
CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  ip_hash      TEXT,
  user_agent_hash TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ          -- NULL = active, NOT NULL = revoked
);

CREATE INDEX sessions_id_idx ON sessions(id);  -- already PK, O(1) lookup
```

Gap 1 reads only `revoked_at` from this table. No schema migration is required.

### Log entry shape (Gap 4)

Not persisted to DB — emitted to stdout/log aggregator. Schema:

```ts
interface LogEntry {
  timestamp : string;   // ISO 8601
  level     : 'error' | 'warn' | 'info' | 'debug';
  message   : string;
  service   : 'hms-server';
  requestId?: string;   // present on all HTTP-context logs
  userId?   : string;   // present on auth events
  ip?       : string;   // present on auth/rate-limit events
  event?    : string;   // present on auth events
  path?     : string;   // present on error/rate-limit events
  method?   : string;   // present on error events
  statusCode?: number;  // present on error events
  stack?    : string;   // present on error events
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Revoked sessions are always rejected

*For any* valid JWT embedding a `sessionId` that maps to a row in the `sessions` table with `revoked_at IS NOT NULL`, the `authenticate` middleware SHALL return HTTP 401 with the message `"Session revoked"`.

**Validates: Requirements 1.1**

---

### Property 2: Unknown sessions are always rejected

*For any* valid JWT embedding a `sessionId` that does not exist in the `sessions` table, the `authenticate` middleware SHALL return HTTP 401 with the message `"Session not found"`.

**Validates: Requirements 1.2**

---

### Property 3: OTP values are always in range and uniformly distributed

*For any* sample of 10,000 generated OTPs, every value SHALL be an integer in the closed range [100000, 999999], and the distribution SHALL pass a chi-squared uniformity test at the p = 0.05 significance level.

**Validates: Requirements 2.1, 2.4**

---

### Property 4: Group encryption keys are always 256-bit and unique

*For any* sample of 1,000 generated group keys, every key SHALL decode to exactly 32 bytes (256 bits), and no two keys in the sample SHALL be identical.

**Validates: Requirements 2.2**

---

### Property 5: Temporary passwords are always unique and sufficiently long

*For any* sample of 10,000 generated temporary passwords, every password SHALL be at least 16 characters long, and all 10,000 values SHALL be distinct.

**Validates: Requirements 7.1, 7.4, 7.5**

---

### Property 6: Contact form rejects all schema-violating inputs

*For any* request body where at least one field violates the Zod schema constraints (name > 100 chars, email invalid or containing CRLF, subject > 200 chars, message > 2000 chars, or any required field missing), the Contact_Route SHALL return HTTP 422 with a structured error body listing the failing fields.

**Validates: Requirements 6.1, 6.2, 6.4**

---

### Property 7: Security headers are present on every response

*For any* HTTP request to any `/api/*` endpoint, the response SHALL include `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin`, and `Cross-Origin-Resource-Policy: same-origin`.

**Validates: Requirements 4.2, 4.3, 4.4, 4.5**

---

### Property 8: Structured log entries always contain required fields

*For any* log call made through the Winston logger, the emitted JSON entry SHALL contain `timestamp`, `level`, `message`, and `service` fields.

**Validates: Requirements 3.1**

---

### Property 9: Billing endpoints deny all non-whitelisted roles

*For any* authenticated request to a billing endpoint from a user whose roles do not include `PATIENT`, `BILLING`, `RECEPTIONIST`, `ADMIN`, or `SUPER_ADMIN`, the response SHALL be HTTP 403.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

---

## Error Handling

### Gap 1 — Session validation errors

| Condition | HTTP Status | Response body |
|---|---|---|
| JWT missing/malformed | 401 | `{ error: 'Missing or malformed Authorization header' }` |
| JWT expired | 401 | `{ error: 'Token expired' }` |
| JWT invalid signature | 401 | `{ error: 'Invalid token' }` |
| No `sessionId` claim | 401 | `{ error: 'Missing session ID' }` |
| Session not in DB | 401 | `{ error: 'Session not found' }` |
| Session revoked | 401 | `{ error: 'Session revoked' }` |
| DB error during lookup | 503 | `{ error: 'Service temporarily unavailable' }` |

The 503 path is critical: the middleware must **never** fail open. If the DB is unreachable, the request is rejected.

### Gap 3 — Password generation errors

`crypto.randomBytes` is synchronous and does not throw under normal conditions. If the Node.js crypto module is unavailable (extremely rare), the error propagates to the global error handler and returns HTTP 500. The transaction is rolled back, so no user record is created without a valid password hash.

### Gap 7 — Contact validation errors

Zod `safeParse` never throws. On failure, the route returns:

```json
{
  "errors": {
    "email": "Invalid email",
    "message": "String must contain at most 2000 character(s)"
  }
}
```

Field names match the Zod path array, flattened to a single-level object for client consumption.

### Gap 8 — Gemini API errors

The early guard (`if (!apiKey) throw new Error('GEMINI_API_KEY not configured')`) prevents any network request when the key is absent. The existing `try/catch` in `sendMessage` catches this and falls back to `getFallbackReply`, so the chatbot degrades gracefully rather than returning a 500.

---

## Testing Strategy

### Framework

The existing test setup uses **Vitest** (inferred from `package.json` devDependencies pattern). Property-based tests use **fast-check**, which is added as a dev dependency. Integration tests use **supertest** against the Express app with a test database.

### Unit and Property Tests

**Gap 1 — Session revocation (new test file: `tests/auth.middleware.test.js`)**

- Integration test: valid JWT with revoked `sessionId` → HTTP 401 `"Session revoked"` (Requirement 10.1)
- Integration test: valid JWT with non-existent `sessionId` → HTTP 401 `"Session not found"`
- Integration test: valid JWT with no `sessionId` claim → HTTP 401 `"Missing session ID"`
- Integration test: DB error during lookup → HTTP 503
- Property test: *For any* random UUID `sessionId` inserted as revoked, the middleware always returns 401 (Property 1)

**Gap 2 — CSPRNG (new test file: `tests/csprng.test.js`)**

- Property test (fast-check, 10,000 runs): all generated OTPs ∈ [100000, 999999] with chi-squared uniformity (Property 3, Requirement 10.2)
- Property test (1,000 runs): all generated group keys decode to 32 bytes and are unique (Property 4)
- Unit test: rate-limiter member suffix is a 16-char hex string

**Gap 3 — Temp password (new test file: `tests/admin.service.test.js`)**

- Property test (fast-check, 10,000 runs): all generated temp passwords ≥ 16 chars and unique (Property 5, Requirement 10.5)
- Unit test: `sendTempPassword` is called with the generated (not hardcoded) password
- Unit test: hardcoded string `'hospital@pass@12345'` does not appear in generated passwords

**Gap 4 — Structured logging (new test file: `tests/logger.test.js`)**

- Property test: *For any* log call, emitted JSON contains `timestamp`, `level`, `message`, `service` (Property 8)
- Unit test: startup log contains `NODE_ENV` and `PORT`
- Unit test: auth event log contains `userId`, `event`, `ip`, `requestId`

**Gap 5 — Security headers (new test file: `tests/security-headers.test.js`)**

- Property test (supertest, multiple endpoints): every response includes all four required headers (Property 7)
- Unit test: HSTS header present in production, absent in development

**Gap 6 — Billing authorization (new test file: `tests/billing.routes.test.js`)**

- Integration test: NURSE JWT → `GET /api/bills/:id` → HTTP 403 (Requirement 10.3)
- Integration test: PATIENT JWT for user A → `GET /api/bills/:id` for user B's bill → HTTP 403 (Requirement 5.6)
- Property test: *For any* role not in the whitelist, billing endpoints return 403 (Property 9)

**Gap 7 — Contact validation (new test file: `tests/contact.routes.test.js`)**

- Property test (fast-check): *For any* body with at least one field violating schema → HTTP 422 with field errors (Property 6, Requirement 10.4)
- Integration test: 6th request from same IP within 15 min → HTTP 429
- Unit test: valid body → HTTP 200

**Gap 8 — Gemini API key (new test file: `tests/chatbot.service.test.js`)**

- Unit test: `callGemini` constructs URL with no `key=` query parameter (Requirement 10.6)
- Unit test: `callGemini` sets `x-goog-api-key` header
- Unit test: missing `GEMINI_API_KEY` → throws `"GEMINI_API_KEY not configured"`

### Property Test Configuration

- Minimum **100 iterations** per property test (fast-check default is 100; set to 10,000 for OTP and password uniqueness tests)
- Each property test is tagged with a comment referencing the design property:
  ```js
  // Feature: zero-trust-security, Property 3: OTP values are always in range and uniformly distributed
  ```
- Tag format: `Feature: {feature_name}, Property {number}: {property_text}`

### Running Tests

```bash
# Single run (CI)
npm test -- --run

# Watch mode (development)
npm test
```

All tests must pass with zero failures before any gap fix is merged (`npm test` exit code 0, Requirement 10.7).
