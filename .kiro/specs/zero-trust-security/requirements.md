# Requirements Document

## Introduction

This feature implements Zero Trust Security compliance for the City General Hospital Management System (HMS). The system is a full-stack web application with a React/Vite frontend and a Node.js/Express backend serving 183 HTTP endpoints and 12 Socket.io event handlers across 19 RBAC roles.

A thorough audit of the codebase was conducted across all six Zero Trust pillars. The system already has strong foundations: RS256 JWT authentication, Argon2id password hashing, CSRF double-submit protection, Redis sliding-window rate limiting, a tamper-evident SHA-256 hash-chain audit log, Helmet.js security headers, and pgcrypto field-level PII encryption.

The gaps identified below are the delta between the current state and full Zero Trust compliance. Each requirement targets a specific, confirmed gap.

---

## Glossary

- **HMS**: Hospital Management System — the full-stack application under audit.
- **Auth_Middleware**: The `authenticate` Express middleware in `server/src/shared/middleware/auth.js` that verifies RS256 JWTs.
- **RBAC_Middleware**: The `authorize()` factory in `server/src/shared/middleware/rbac.js`.
- **Audit_Logger**: The `auditLog()` function and `auditMiddleware` in `server/src/shared/middleware/audit.js`.
- **Rate_Limiter**: The Redis sliding-window rate limiter in `server/src/shared/middleware/rateLimiter.js`.
- **Structured_Logger**: A Winston-based JSON logger that replaces `console.*` calls for application-level events.
- **Session_Validator**: A middleware component that checks the JWT's embedded `sessionId` against the `sessions` table to detect revoked sessions within the 15-minute token window.
- **CSPRNG**: Cryptographically Secure Pseudo-Random Number Generator — `crypto.randomBytes()` or `crypto.getRandomValues()`.
- **OTP_Generator**: The function in `auth.service.js` that produces 6-digit one-time passwords.
- **Group_Key_Generator**: The function in `messaging.service.js` that produces AES-256-GCM group encryption keys.
- **Default_Password**: The hardcoded string `'hospital@pass@12345'` in `admin.service.js` used as the initial password for all newly created staff accounts.
- **Gemini_Client**: The function `callGemini()` in `chatbot.service.js` that calls the Google Gemini API.
- **Helmet_Config**: The `helmet()` call in `server/src/app.js`.
- **HSTS**: HTTP Strict Transport Security — an HTTP response header that instructs browsers to use HTTPS only.
- **Referrer_Policy**: An HTTP response header that controls how much referrer information is sent with requests.
- **Permissions_Policy**: An HTTP response header that controls which browser features the application may use.
- **CSP**: Content Security Policy — an HTTP response header that restricts resource loading.
- **CORS_Config**: The `cors()` middleware configuration in `server/src/app.js` and `server/src/socket.js`.
- **Billing_Routes**: The routes in `server/src/modules/billing/billing.routes.js` that use `authorize('*')`.
- **Contact_Route**: The public `POST /api/contact` route in `server/src/modules/contact/contact.routes.js`.
- **Bcrypt_Dep**: The `bcrypt` package listed in `server/package.json` that is imported nowhere in the codebase.
- **Morgan_Dep**: The `morgan` package listed in `server/package.json` that is imported nowhere in the codebase.
- **Test_Suite**: The set of automated tests written to verify each security control.

---

## Requirements

### Requirement 1: Revoked-Session Detection Within JWT Window

**User Story:** As a security officer, I want force-logged-out sessions to be immediately rejected even if the JWT has not yet expired, so that a compromised or administratively revoked session cannot be used for up to 15 minutes after revocation.

#### Acceptance Criteria

1. WHEN a request arrives with a valid JWT whose embedded `sessionId` maps to a row in the `sessions` table with `revoked_at IS NOT NULL`, THE Auth_Middleware SHALL reject the request with HTTP 401 and the message `"Session revoked"`.
2. WHEN a request arrives with a valid JWT whose embedded `sessionId` does not exist in the `sessions` table, THE Auth_Middleware SHALL reject the request with HTTP 401 and the message `"Session not found"`.
3. WHILE the `sessions` table lookup is unavailable due to a database error, THE Auth_Middleware SHALL reject the request with HTTP 503 rather than failing open.
4. THE Auth_Middleware SHALL complete the session validation database lookup within 50 ms under normal load (single indexed query on `sessions.id`).
5. WHEN a JWT contains no `sessionId` claim, THE Auth_Middleware SHALL reject the request with HTTP 401 and the message `"Missing session ID"`.

---

### Requirement 2: Cryptographically Secure OTP Generation

**User Story:** As a security engineer, I want all security-sensitive random values to be generated using a CSPRNG, so that OTPs, group encryption keys, and rate-limiter nonces cannot be predicted by an attacker.

#### Acceptance Criteria

1. THE OTP_Generator SHALL produce 6-digit numeric OTPs using `crypto.randomInt(100000, 1000000)` instead of `Math.random()`.
2. THE Group_Key_Generator SHALL produce 256-bit AES keys using `crypto.getRandomValues(new Uint8Array(32))` or `crypto.randomBytes(32)` instead of `Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))`.
3. THE Rate_Limiter SHALL use `crypto.randomBytes(8).toString('hex')` as the sorted-set member suffix instead of `Math.random()`.
4. FOR ALL generated OTPs, the distribution of values SHALL be statistically uniform across the range 100000–999999 (verified by chi-squared test in the property-based test suite).

---

### Requirement 3: Structured Application Logging

**User Story:** As an IT administrator, I want all application-level events to be emitted as structured JSON logs, so that logs can be ingested by a SIEM, searched programmatically, and correlated with the audit trail.

#### Acceptance Criteria

1. THE Structured_Logger SHALL be a Winston logger configured with a JSON transport that emits log entries containing at minimum: `timestamp`, `level`, `message`, `service`, and `requestId` fields.
2. WHEN the application starts, THE Structured_Logger SHALL log a startup event at `info` level including the `NODE_ENV` and `PORT` values.
3. WHEN an authentication event occurs (login success, login failure, logout, token refresh, 2FA verify), THE Structured_Logger SHALL emit a structured log entry at `info` or `warn` level including `userId` (or `username` for failures), `event`, `ip`, and `requestId`.
4. WHEN a rate-limit threshold is exceeded, THE Structured_Logger SHALL emit a structured log entry at `warn` level including `ip`, `path`, `limit`, and `requestId`.
5. WHEN an unhandled server error occurs (HTTP 5xx), THE Structured_Logger SHALL emit a structured log entry at `error` level including `requestId`, `method`, `path`, `statusCode`, and the error `stack`.
6. THE Structured_Logger SHALL replace all `console.log`, `console.warn`, `console.error`, and `console.debug` calls in production-path server code with equivalent Winston calls.
7. WHERE `NODE_ENV` is `development`, THE Structured_Logger SHALL additionally emit human-readable colorized output via a `simple` or `colorize` transport.

---

### Requirement 4: HSTS, Referrer-Policy, and Permissions-Policy Headers

**User Story:** As a security engineer, I want the server to emit HSTS, Referrer-Policy, and Permissions-Policy headers on every response, so that browsers enforce HTTPS-only connections and the application's attack surface is minimised.

#### Acceptance Criteria

1. WHEN the application runs with `NODE_ENV=production`, THE Helmet_Config SHALL enable `Strict-Transport-Security` with `max-age=31536000; includeSubDomains; preload`.
2. THE Helmet_Config SHALL set `Referrer-Policy` to `strict-origin-when-cross-origin` on every response.
3. THE Helmet_Config SHALL set `Permissions-Policy` to `camera=(), microphone=(), geolocation=(), payment=()` on every response, restricting all sensitive browser APIs.
4. THE Helmet_Config SHALL enable `Cross-Origin-Opener-Policy` set to `same-origin` on every response.
5. THE Helmet_Config SHALL enable `Cross-Origin-Resource-Policy` set to `same-origin` on every response.
6. WHEN a browser sends a request over HTTP in production, THE HMS SHALL respond with a redirect to the HTTPS equivalent URL (HTTP 301).

---

### Requirement 5: Billing Route Authorization Tightening

**User Story:** As a security officer, I want all billing endpoints to require explicit role-based authorization rather than wildcard access, so that only patients viewing their own bills and authorised billing staff can access financial records.

#### Acceptance Criteria

1. THE Billing_Routes `GET /patient/:patientId` endpoint SHALL require `authenticate` and `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` with `checkOwnership('patient')` enforced for the `PATIENT` role.
2. THE Billing_Routes `GET /:id` endpoint SHALL require `authenticate` and `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` with `checkOwnership('bill')` enforced for the `PATIENT` role.
3. THE Billing_Routes `PATCH /:id/pay` endpoint SHALL require `authenticate` and `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` with `checkOwnership('bill')` enforced for the `PATIENT` role.
4. THE Billing_Routes `GET /insurance/patient/:patientId` endpoint SHALL require `authenticate` and `authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN')` with `checkOwnership('patient')` enforced for the `PATIENT` role.
5. WHEN an authenticated user with role `NURSE` attempts to access `GET /api/bills/:id`, THE HMS SHALL respond with HTTP 403.
6. WHEN an authenticated `PATIENT` user attempts to access another patient's bill via `GET /api/bills/:id`, THE HMS SHALL respond with HTTP 403.

---

### Requirement 6: Contact Route Input Validation and Rate Limiting

**User Story:** As a security engineer, I want the public contact form endpoint to use Zod schema validation and a stricter rate limit, so that it cannot be abused for spam or injection attacks.

#### Acceptance Criteria

1. THE Contact_Route SHALL validate the request body using a Zod schema that enforces: `name` (string, 1–100 chars), `email` (valid email format, max 254 chars), `subject` (string, 1–200 chars), `message` (string, 1–2000 chars).
2. WHEN the Contact_Route receives a body that fails Zod validation, THE HMS SHALL respond with HTTP 422 and a structured error listing the failing fields.
3. THE Contact_Route SHALL apply a dedicated rate limiter of 5 requests per 15 minutes per IP address, separate from the global 200 req/min limiter.
4. IF the Contact_Route receives a request body where `email` contains an injection pattern (e.g., newline characters, CRLF sequences), THEN THE HMS SHALL reject the request with HTTP 422.

---

### Requirement 7: Cryptographically Random Default Password Generation

**User Story:** As a security engineer, I want newly created staff accounts to receive a unique, cryptographically random temporary password rather than a shared hardcoded default, so that a single leaked credential cannot compromise all new accounts.

#### Acceptance Criteria

1. WHEN a new staff user account is created via `POST /api/admin/users`, THE HMS SHALL generate a unique temporary password using `crypto.randomBytes(16).toString('base64url')` (minimum 128 bits of entropy).
2. THE Default_Password constant `'hospital@pass@12345'` SHALL be removed from `admin.service.js`.
3. THE HMS SHALL send the unique temporary password to the new user's email address via the existing `sendTempPassword` email service.
4. WHEN two staff accounts are created in the same request batch, THE HMS SHALL generate a distinct temporary password for each account.
5. FOR ALL generated temporary passwords, each password SHALL contain at least 16 characters and SHALL be unique across a sample of 10,000 generated values (verified by property-based test).

---

### Requirement 8: Gemini API Key Excluded from Request URLs

**User Story:** As a security engineer, I want the Gemini API key to be passed as an HTTP header rather than a URL query parameter, so that the key is not exposed in server access logs, proxy logs, or browser history.

#### Acceptance Criteria

1. THE Gemini_Client SHALL pass the API key using the `x-goog-api-key` HTTP request header instead of appending `?key=${apiKey}` to the URL.
2. THE Gemini_Client SHALL construct the request URL without any query parameters containing the API key.
3. WHEN the `GEMINI_API_KEY` environment variable is not set, THE Gemini_Client SHALL throw an error with the message `"GEMINI_API_KEY not configured"` before making any network request.
4. THE Gemini_Client SHALL not log the API key value at any log level.

---

### Requirement 9: Unused Dependency Removal

**User Story:** As a security engineer, I want unused packages removed from the server's dependency tree, so that the supply-chain attack surface is minimised and dependency audits are not polluted by irrelevant packages.

#### Acceptance Criteria

1. THE HMS server `package.json` SHALL NOT list `bcrypt` as a dependency, given that `argon2` is the sole password hashing library used in the codebase.
2. THE HMS server `package.json` SHALL NOT list `morgan` as a dependency if HTTP request logging is handled by the Structured_Logger (Requirement 3) or if `morgan` is not imported anywhere in the server source.
3. WHEN `npm audit` is run against the server `package.json` after removal, THE HMS SHALL report zero high or critical severity vulnerabilities introduced by the removed packages.

---

### Requirement 10: Test Suite for Security Controls

**User Story:** As a developer, I want automated tests for each implemented security control, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE Test_Suite SHALL include an integration test verifying that a request with a revoked `sessionId` in the JWT receives HTTP 401 (Requirement 1).
2. THE Test_Suite SHALL include a property-based test verifying that 10,000 generated OTPs all fall within the range [100000, 999999] and follow a uniform distribution (Requirement 2).
3. THE Test_Suite SHALL include an integration test verifying that `GET /api/bills/:id` returns HTTP 403 for a `NURSE` role token (Requirement 5).
4. THE Test_Suite SHALL include an integration test verifying that `POST /api/contact` with a body exceeding the Zod schema limits returns HTTP 422 (Requirement 6).
5. THE Test_Suite SHALL include a property-based test verifying that 10,000 generated temporary passwords are all unique and at least 16 characters long (Requirement 7).
6. THE Test_Suite SHALL include a unit test verifying that the Gemini client constructs a request URL with no `key=` query parameter (Requirement 8).
7. WHEN the Test_Suite is executed with `npm test`, THE HMS SHALL report all tests as passing with zero failures.
