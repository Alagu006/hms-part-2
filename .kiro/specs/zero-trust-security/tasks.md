# Implementation Plan: Zero Trust Security Compliance

## Overview

Close the nine security gaps identified in the Zero Trust audit of the HMS. Changes are surgical and isolated — each gap is fixed in its own task with minimal blast radius. Implementation follows the risk-ranked rollout order: High priority gaps first (credential exposure, predictable randomness, API key leakage), then Medium (session revocation, billing authorization, structured logging), then Low (security headers, contact validation, unused dependencies). Tests are written after the core fixes are in place.

## Tasks

- [x] 1. Gap 3 — Remove hardcoded default password, generate per-account CSPRNG password
  - [x] 1.1 Replace hardcoded `DEFAULT_PASSWORD` constant with `crypto.randomBytes(16).toString('base64url')` in `server/src/modules/admin/admin.service.js`
    - Delete the `DEFAULT_PASSWORD = 'hospital@pass@12345'` constant
    - Generate `tempPassword` inline using `crypto.randomBytes(16).toString('base64url')` at the point of account creation
    - Pass `tempPassword` to `argon2.hash()` and to `sendTempPassword()` (replacing the hardcoded value in both calls)
    - Add `tempPassword` to the `createUser` return value so the admin controller can include it in the HTTP 201 response body
    - Verify the `must_change_password = TRUE` flag is still set (no change needed, just confirm)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 1.2 Write property test for temporary password uniqueness and length
    - Create `server/tests/admin.service.test.js`
    - **Property 5: Temporary passwords are always unique and sufficiently long**
    - Use fast-check to generate 10,000 passwords and assert all are ≥ 16 characters and all are distinct
    - Add unit test asserting the hardcoded string `'hospital@pass@12345'` never appears in output
    - Add unit test asserting `sendTempPassword` is called with the generated (not hardcoded) password
    - Tag: `// Feature: zero-trust-security, Property 5: Temporary passwords are always unique and sufficiently long`
    - _Requirements: 7.1, 7.4, 7.5 — Validates: Requirements 10.5_

- [x] 2. Gap 2 — Replace all `Math.random()` with CSPRNG
  - [x] 2.1 Replace `Math.random()` in `server/src/modules/auth/auth.service.js` (OTP generation)
    - Import `crypto` (Node built-in)
    - Replace the OTP generation expression with `String(crypto.randomInt(100000, 1000000))`
    - Confirm the return type is still a 6-digit numeric string
    - _Requirements: 2.1_

  - [x] 2.2 Replace `Math.random()` in `server/src/modules/messaging/messaging.service.js` (AES-256 group key)
    - Replace `Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))` with `crypto.randomBytes(32)`
    - Convert to base64 with `.toString('base64')` to preserve the existing key format
    - _Requirements: 2.2_

  - [x] 2.3 Replace `Math.random()` in `server/src/shared/middleware/rateLimiter.js` (sorted-set member suffix)
    - Replace the `Math.random()` suffix with `crypto.randomBytes(8).toString('hex')`
    - Ensure the zadd member format remains `${now}-${suffix}`
    - _Requirements: 2.3_

  - [x] 2.4 Replace `Math.random()` in `server/src/modules/billing/billing.service.js` (bill number suffix)
    - Replace the random suffix with `crypto.randomBytes(3).toString('hex').toUpperCase()`
    - Confirm the bill number format is preserved
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 2.5 Write property test for OTP uniformity (CSPRNG)
    - Create `server/tests/csprng.test.js`
    - **Property 3: OTP values are always in range and uniformly distributed**
    - Use fast-check with 10,000 runs: assert every OTP ∈ [100000, 999999] and passes chi-squared uniformity test at p = 0.05
    - Add property test (1,000 runs): all generated group keys decode to exactly 32 bytes and are unique
    - Add unit test: rate-limiter member suffix is a 16-character hex string
    - Tag: `// Feature: zero-trust-security, Property 3: OTP values are always in range and uniformly distributed`
    - _Requirements: 2.1, 2.2, 2.3, 2.4 — Validates: Requirements 10.2_

- [x] 3. Gap 8 — Move Gemini API key from URL query param to `x-goog-api-key` header
  - [x] 3.1 Update `callGemini()` in `server/src/modules/chatbot/chatbot.service.js`
    - Add early guard: `if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')`
    - Remove `?key=${apiKey}` from the URL construction — URL must contain no `key=` query parameter
    - Add `'x-goog-api-key': apiKey` to the `headers` object in the `fetch` call
    - Confirm the API key value is never passed to the logger at any log level
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 3.2 Write unit tests for Gemini client
    - Create `server/tests/chatbot.service.test.js`
    - Unit test: `callGemini` constructs a URL with no `key=` query parameter (Requirement 10.6)
    - Unit test: `callGemini` sets the `x-goog-api-key` header with the correct value
    - Unit test: missing `GEMINI_API_KEY` env var → throws `"GEMINI_API_KEY not configured"` before any network request
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Checkpoint — High priority gaps complete
  - Ensure all existing tests still pass after Gap 2, 3, and 8 changes: `npm test -- --run`
  - Confirm no `Math.random()` calls remain in `auth.service.js`, `messaging.service.js`, `rateLimiter.js`, or `billing.service.js`
  - Confirm `'hospital@pass@12345'` does not appear anywhere in `server/src/**`
  - Confirm `?key=` does not appear in the Gemini URL construction
  - Ask the user if questions arise before proceeding to Medium priority gaps.

- [x] 5. Gap 1 — Add revoked-session detection to auth middleware
  - [x] 5.1 Add session DB lookup to `server/src/shared/middleware/auth.js`
    - Import `pool` from `../../shared/db/pool.js` (or the correct relative path)
    - After successful JWT verification, extract `payload.sessionId`; if absent return HTTP 401 `{ error: 'Missing session ID' }`
    - Execute `SELECT revoked_at FROM sessions WHERE id = $1` with `[sessionId]`
    - On DB error: return HTTP 503 `{ error: 'Service temporarily unavailable' }` (fail-closed, never fail-open)
    - If no row found: return HTTP 401 `{ error: 'Session not found' }`
    - If `revoked_at IS NOT NULL`: return HTTP 401 `{ error: 'Session revoked' }`
    - If `revoked_at IS NULL`: call `next()` as before
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 5.2 Write integration tests for session revocation
    - Create `server/tests/auth.middleware.test.js`
    - Integration test: valid JWT with revoked `sessionId` → HTTP 401 `"Session revoked"` (Requirement 10.1)
    - Integration test: valid JWT with non-existent `sessionId` → HTTP 401 `"Session not found"`
    - Integration test: valid JWT with no `sessionId` claim → HTTP 401 `"Missing session ID"`
    - Integration test: DB error during lookup → HTTP 503 (never 200)
    - **Property 1: Revoked sessions are always rejected** — for any random UUID `sessionId` inserted as revoked, middleware always returns 401
    - **Property 2: Unknown sessions are always rejected** — for any random UUID `sessionId` not in DB, middleware always returns 401
    - Tag: `// Feature: zero-trust-security, Property 1: Revoked sessions are always rejected`
    - _Requirements: 1.1, 1.2, 1.3, 1.5 — Validates: Requirements 10.1_

- [x] 6. Gap 6 — Replace `authorize('*')` in billing routes with explicit role list
  - [x] 6.1 Update `server/src/modules/billing/billing.routes.js`
    - Replace `authorize('*')` on `GET /patient/:patientId` with `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` and add `checkOwnership('patient')`
    - Replace `authorize('*')` on `GET /:id` with `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` (keep existing `checkOwnership('bill')`)
    - Replace `authorize('*')` on `PATCH /:id/pay` with `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` and add `checkOwnership('bill')`
    - Replace `authorize('*')` on `GET /insurance/patient/:patientId` with `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` and add `checkOwnership('patient')`
    - Confirm `checkOwnership` already skips the ownership check for non-PATIENT roles (no conditional logic needed in route definitions)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.2 Write integration tests for billing authorization
    - Create `server/tests/billing.routes.test.js`
    - Integration test: NURSE JWT → `GET /api/bills/:id` → HTTP 403 (Requirement 10.3)
    - Integration test: PATIENT JWT for user A → `GET /api/bills/:id` for user B's bill → HTTP 403
    - **Property 9: Billing endpoints deny all non-whitelisted roles** — for any role not in `[PATIENT, BILLING, RECEPTIONIST, ADMIN, SUPER_ADMIN]`, billing endpoints return 403
    - Tag: `// Feature: zero-trust-security, Property 9: Billing endpoints deny all non-whitelisted roles`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Gap 4 — Introduce Winston structured logger, replace all `console.*` calls
  - [x] 7.1 Create `server/src/shared/logger.js`
    - Create a Winston logger instance with a JSON transport (production) and colorized simple transport (development, gated on `NODE_ENV === 'development'`)
    - Set `defaultMeta: { service: 'hms-server' }` and `level: process.env.LOG_LEVEL || 'info'`
    - Export the logger as a named export: `export const logger`
    - _Requirements: 3.1, 3.7_

  - [x] 7.2 Add startup log and replace `console.*` in `server/src/app.js`
    - Import `logger` from `./shared/logger.js`
    - Add startup log at `info` level including `NODE_ENV` and `PORT` values
    - Replace all `console.log`, `console.warn`, `console.error`, `console.debug` calls with equivalent `logger.*` calls
    - Update the global error handler to use `logger.error()` with `requestId`, `method`, `path`, `statusCode`, and `stack`
    - _Requirements: 3.2, 3.5, 3.6_

  - [x] 7.3 Add auth event logging in `server/src/modules/auth/auth.service.js`
    - Import `logger`
    - Emit structured log entries at `info` or `warn` level for: login success, login failure, logout, token refresh, 2FA verify
    - Each entry must include `userId` (or `username` for failures), `event`, `ip`, and `requestId`
    - Replace any remaining `console.*` calls in this file
    - _Requirements: 3.3, 3.6_

  - [x] 7.4 Add rate-limit logging in `server/src/shared/middleware/rateLimiter.js`
    - Import `logger`
    - Emit a `warn` level log when a rate-limit threshold is exceeded, including `ip`, `path`, `limit`, and `requestId`
    - Replace any remaining `console.*` calls in this file
    - _Requirements: 3.4, 3.6_

  - [x] 7.5 Replace remaining `console.*` calls across all other server source files
    - Search `server/src/**` for any remaining `console.log`, `console.warn`, `console.error`, `console.debug` calls
    - Replace each with the equivalent `logger.*` call, importing `logger` where not already imported
    - Dev-only OTP logging (if any) should become `logger.debug()`
    - _Requirements: 3.6_

  - [ ]* 7.6 Write tests for structured logger
    - Create `server/tests/logger.test.js`
    - **Property 8: Structured log entries always contain required fields** — for any log call, emitted JSON contains `timestamp`, `level`, `message`, `service`
    - Unit test: startup log contains `NODE_ENV` and `PORT`
    - Unit test: auth event log contains `userId`, `event`, `ip`, `requestId`
    - Tag: `// Feature: zero-trust-security, Property 8: Structured log entries always contain required fields`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 8. Checkpoint — Medium priority gaps complete
  - Ensure all tests pass: `npm test -- --run`
  - Confirm no `console.*` calls remain in `server/src/**` (search for `console\.log\|console\.warn\|console\.error\|console\.debug`)
  - Confirm all four billing routes no longer use `authorize('*')`
  - Ask the user if questions arise before proceeding to Low priority gaps.

- [x] 9. Gap 5 — Add HSTS, Referrer-Policy, Permissions-Policy, COOP, CORP to Helmet config
  - [x] 9.1 Update the `helmet()` call in `server/src/app.js`
    - Add `hsts` option gated on `NODE_ENV === 'production'`: `{ maxAge: 31536000, includeSubDomains: true, preload: true }`
    - Add `referrerPolicy: { policy: 'strict-origin-when-cross-origin' }`
    - Add `permissionsPolicy: { features: { camera: [], microphone: [], geolocation: [], payment: [] } }`
    - Add `crossOriginOpenerPolicy: { policy: 'same-origin' }`
    - Add `crossOriginResourcePolicy: { policy: 'same-origin' }`
    - All additions go inside the existing `helmet({...})` options object — do not install a second middleware
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 9.2 Write security header tests
    - Create `server/tests/security-headers.test.js`
    - **Property 7: Security headers are present on every response** — use supertest against multiple `/api/*` endpoints and assert all four required headers are present on every response
    - Unit test: HSTS header is present when `NODE_ENV=production`, absent when `NODE_ENV=development`
    - Tag: `// Feature: zero-trust-security, Property 7: Security headers are present on every response`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 10. Gap 7 — Add Zod schema validation and dedicated rate limiter to `/api/contact`
  - [x] 10.1 Update `server/src/modules/contact/contact.routes.js`
    - Import `z` from `zod`
    - Define `contactSchema` with: `name` (string, 1–100 chars), `email` (valid email, max 254 chars, no CRLF characters), `subject` (string, 1–200 chars), `message` (string, 1–2000 chars)
    - Add a dedicated rate limiter: 5 requests per 15 minutes per IP, keyed as `contact:${req.ip}`, separate from the global limiter
    - Replace the existing hand-rolled validation with `contactSchema.safeParse(req.body)`
    - On validation failure, return HTTP 422 with a structured error object listing failing fields (flatten Zod error paths to a single-level object)
    - Retain the existing `escapeHtml` helper for email body safety
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.2 Write contact route tests
    - Create `server/tests/contact.routes.test.js`
    - **Property 6: Contact form rejects all schema-violating inputs** — use fast-check to generate bodies with at least one field violating schema constraints and assert HTTP 422 with field errors
    - Integration test: 6th request from same IP within 15 minutes → HTTP 429
    - Unit test: valid body → HTTP 200
    - Tag: `// Feature: zero-trust-security, Property 6: Contact form rejects all schema-violating inputs`
    - _Requirements: 6.1, 6.2, 6.3, 6.4 — Validates: Requirements 10.4_

- [x] 11. Gap 9 — Remove unused `bcrypt` and `morgan` dependencies
  - [x] 11.1 Confirm zero imports and remove from `server/package.json`
    - Search `server/src/**` for any `import.*bcrypt` or `require.*bcrypt` — confirm zero results
    - Search `server/src/**` for any `import.*morgan` or `require.*morgan` — confirm zero results
    - Remove `bcrypt` from `dependencies` in `server/package.json`
    - Remove `morgan` from `dependencies` in `server/package.json`
    - Run `npm install` in `server/` to update `package-lock.json`
    - _Requirements: 9.1, 9.2_

- [x] 12. Final checkpoint — Run full test suite and confirm all tests pass
  - Run `npm test -- --run` in `server/` and confirm exit code 0 with zero failures
  - Confirm `npm audit` reports zero high or critical severity vulnerabilities (Requirement 9.3)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 4, 8, and 12 ensure incremental validation after each priority tier
- Property tests validate universal correctness properties (Properties 1–9 from the design document)
- Unit and integration tests validate specific examples and edge cases
- `fast-check` must be added as a dev dependency (`npm install --save-dev fast-check`) before running property tests
- After deploying Gap 8, rotate the Gemini API key in the environment configuration — the old key was exposed in access logs
