# HMS Security / RBAC / Zero-Trust / Performance / DB / Test Metrics

> **Scope:** Full-stack Hospital Management System — Express + PostgreSQL + Redis backend (`server/`), React client (`client/`).
> **Measured on:** 2026-08-10 (local development environment, NODE_ENV=development, PostgreSQL on `localhost:5555`, Redis `localhost:6379`).
> **Method:** Static analysis of `server/src/**` + `server/src/db/**`, live DB queries, live HTTP measurements, automated test suite (with coverage), and an external black-box security script.
> **Rule:** No value is estimated where evidence is unavailable — those are marked **`NOT FOUND`**. Every metric states its formula, calculation, source files, assumptions and confidence.

---

## 1. Executive Summary

The system is a defense-in-depth API (209 REST endpoints across 32 route files + 2 app-level routes) with:

- **Authentication:** 200 / 209 endpoints (95.7 %) require a session-backed RS256-signed JWT, verified at 5 entry points, all with the algorithm pinned to `RS256` and `iss`/`aud` enforced. Tokens are bound to a server-side session that is re-checked against PostgreSQL **on every request** (fail-closed: 503 if the DB is unreachable). Sessions are revocable; 190 sessions exist live, 188 active. 1 of 20 seeded users has 2FA enabled.
- **Authorization (RBAC):** 168 / 209 endpoints (80.4 %) carry an explicit `authorize(...)` role gate; 32 authenticated endpoints rely on authentication alone (read-only/low-risk: doctor directory, notifications, messaging reads). A 19-value `user_role` enum covers all 19 roles in policy; 13 roles are actually assigned to the 20 live users.
- **Zero trust posture:** per-request session revocation (fail-closed), IP/UA context-drift fingerprinting, fail-closed rate limiting on auth (auth/login/OTP), global API rate limiting, fail-closed IP blocking, and a tamper-evident SHA-256 hash-chained audit log covering 100 % of API endpoints (15,210 live entries).
- **Cross-cutting:** CSRF protection on 100 % of non-GET requests (108/108), zod validation on 146 endpoints, 16 ownership-scoped endpoints.
- **Data at rest:** 25 columns are *declared* `pgp_sym_encrypt` in `schema.sql`; **all 25 now have an implemented encryption path.** `023_at_rest_encryption.sql` covered 7; migration `024_medical_records_ot_notes_encryption.sql` (new) adds the final 5 (`medical_records` chief_complaint/diagnosis/treatment_plan/notes + `ot_schedules` notes), and the app layer already encrypted the remaining 13 via `pgEncrypt`/`pgDecryptFields`.
- **Quality:** 783 automated tests across 62 files (0 skipped) pass; line coverage 60.71 %, branch coverage 68.69 %. The `authorize` RBAC middleware, `validate` middleware, and `checkOwnership` middleware are now at **100 %** statement coverage (`rbac.test.js`, `validate.test.js`, `ownership.test.js`).
- **Performance (live, dev machine):** median latency 2.4 ms (`/health`) to 17.0 ms (`/api/patients?limit=50`); P95 up to 31.4 ms. Throughput / concurrency / P99: `NOT FOUND` — no load test was stored.

**During measurement, the test suite caught a real regression:** a leftover debug `console.log("JWT ALGORITHM:", jwt.decode(accessToken, ...))` in `auth.service.js:224` referenced an undefined variable, breaking the token-refresh path (3 failing tests). It was removed; the suite is green again (722/722).

---

## 2. Architecture Overview

- **HTTP stack:** Express, `helmet` CSP/HSTS/Referrer-Policy/Permissions-Policy, CORS allow-listing (`corsOriginCheck`), JSON body limit 2 MB, request-id.
- **Middleware order** (`server/src/app.js`):
  1. `apiRateLimiter` for all `/api` (app.js:127) — 200 req/min/IP, **fail-open**.
  2. `ipBlockMiddleware` for all `/api` (app.js:132) — **fail-closed** (503 if block list DB unreachable).
  3. `auditMiddleware` for all `/api` (app.js:135) — 100 % endpoint audit coverage.
  4. Body parsing + cookie parser (app.js:138-139).
  5. `doubleCsrf` for all non-GET requests (app.js:153-158) — 100 % CSRF coverage of mutating methods.
  6. Input sanitization (null/control-byte strip), error handler.
- **Per-route modules** (`server/src/modules/**/*.routes.js`, 32 files) add `authenticate`, `authorize(...)`, `checkOwnership`, `validate(...)` and stricter limiters.
- **Auth model:** login → (optional 2FA OTP via Redis) → RS256 access JWT (15 min, `auth.service.js`) + single-use rotating opaque refresh token (Redis, 7 days). Per-request DB session check with fail-closed 503 and non-blocking IP/UA context-flag.
- **Data layer:** PostgreSQL (59 tables), Redis (sessions, refresh tokens, rate limits, OTP, 2FA, IP block cache), BullMQ background jobs, WebSockets (Socket.IO, JWT-verified).
- **Client:** React + Vite; AES-256-GCM encryption layer for messages/files/notifications with server-issued group keys (`client/src/shared/utils/crypto.js`, `sessionKey.js`).

---

## 3. Security Metrics

### 3.1 Endpoint inventory (raw inputs)
| Metric | Value | Formula / source |
|---|---|---|
| Total REST endpoints | **209** | 207 module routes (`router.get/post/put/patch/delete` in 32 `*.routes.js`) + 2 app-level (`GET /api/auth/csrf-token` app.js:186, `GET /health` app.js:223) |
| By method | GET 101 · POST 57 · PUT 1 · PATCH 34 · DELETE 16 | `router.*` regex audit of all route files (python block-parser, 2026-08-10) |
| Auth-protected | **200** | route registered under `authenticate` inline or module-level `router.use(authenticate)` |
| Public | **9** | `GET /api/auth/csrf-token`, `GET /health`, `POST /api/auth/{login,refresh,logout,otp/request,change-password,2fa/verify}`, `POST /api/contact/` |

### 3.2 Authentication coverage
- **Formula:** `AuthenticationCoverage% = (auth-protected endpoints ÷ total endpoints) × 100`
- **Calculation:** `200 ÷ 209 × 100 = 95.69 %`
- **Source:** `server/src/app.js` (mounts 189-220), route files listed in the Evidence Appendix.
- **Assumptions:** the 9 public endpoints are intentional (pre-auth flows, health, CSRF bootstrap, contact form).
- **Confidence:** High — derived by script over all route files; cross-checked manually.

### 3.3 JWT validation coverage
- **Formula:** `JWTValidationCoverage% = (entry points performing pinned-RS256 verification ÷ total authenticated entry points) × 100`
- **Calculation:** all 5 token-consuming entry points verify with `algorithms: ['RS256']` + `iss`/`aud` → `5 ÷ 5 × 100 = 100 %`
- **Sources:** `server/src/shared/middleware/auth.js` (verify ~44-48), `server/src/socket.js` (26-30), `server/src/modules/messaging/messaging.socket.js`, `server/src/modules/notifications/notification.socket.js`, `server/src/modules/telemedicine/telemedicine.socket.js`.
- **Live evidence:** external script sent `Authorization: Bearer fake.jwt.token` → rejected (`security_validation.py`, run 2026-08-10). Signing key is 2048-bit RSA (`server/keys/private.pem`/`public.pem`, gitignored) — see `jwt_migration.md`.
- **Confidence:** High.

### 3.4 Session security / revocation coverage
- **Formula:** `SessionRevocationCoverage% = (authenticated requests performing a live session DB check ÷ authenticated requests) × 100`
- **Calculation:** `100 %` — every authenticated request re-reads the session row (`revoked_at`) in PostgreSQL; revoked → 401; DB down → **503 (fail-closed)**.
- **Source:** `server/src/shared/middleware/auth.js`; session table `sessions` (schema.sql), live state: **190 sessions, 188 active**.
- **Confidence:** High (code + tests `auth.middleware.test.js`, 13 cases; live DB state).

### 3.5 CSRF protection coverage
- **Formula:** `CSRFCoverage% = (non-GET endpoints behind doubleCsrf ÷ total non-GET endpoints) × 100`
- **Calculation:** non-GET = POST 57 + PUT 1 + PATCH 34 + DELETE 16 = **108**; all are behind the global non-GET guard → `108 ÷ 108 × 100 = 100 %`
- **Source:** `server/src/app.js:141-158` (`doubleCsrf`, `getSessionIdentifier: req.ip`, cookie `x-csrf-token` dev / `__Host-psifi.x-csrf-token` prod, `sameSite: strict`, `httpOnly`, 64-byte token).
- **Live evidence:** POST without a CSRF header → 403 (external script "CSRF Protection — Passed"; direct curl reproduced 403).
- **Confidence:** High.

### 3.6 Rate limiting coverage
- **Formula:** `RateLimitCoverage% = (endpoints behind ≥1 limiter ÷ total endpoints) × 100`
- **Calculation:** global `apiRateLimiter` covers all `/api` (209 − `/health` + 1 = **209**); stricter fail-closed limiters on the 8 auth endpoints (`authRateLimiter` 100/15min dev, `loginRateLimiter` 50/15min dev per IP+user, `otpRateLimiter` 50/15min dev), plus `contactRateLimiter` and `chatbot` IP limiter (30/min).
- **Details:** `server/src/shared/middleware/rateLimiter.js` (sliding-window Redis zset), `server/src/app.js:127`, `auth.routes.js:32-49`.
- **Note:** `/health` is intentionally outside the limiter — the external script's 300-request test against `/health` therefore reported "Not Triggered" (a script target choice, not a system gap). The limiter's 429 behavior is covered by `rate-limiter.test.js` (8 cases).
- **Confidence:** High (code); High (behavior via tests).

### 3.7 IP blocking coverage
- **Formula:** `IPBlockCoverage% = (endpoints behind ipBlockMiddleware ÷ total endpoints) × 100`
- **Calculation:** `app.use('/api', ipBlockMiddleware)` (app.js:132) → **209/209 = 100 %**; Redis cache + PostgreSQL `blocked_ips` source of truth; 403 on blocked, **503 fail-closed** if DB unreachable. Live: `blocked_ips` table empty (0 rows).
- **Source:** `server/src/shared/middleware/ipBlock.js`; `ip-block.test.js` (5 cases).
- **Confidence:** High.

### 3.8 Audit logging coverage & integrity
- **Formula (coverage):** `AuditCoverage% = (endpoints auto-audited ÷ total endpoints) × 100`
- **Calculation:** global `auditMiddleware` (app.js:135) auto-logs every `/api` response → **209/209 = 100 %**; action = `VIEW` for GET else the method, entity = `baseUrl + path` (`server/src/shared/middleware/audit.js:98-125`).
- **Live evidence:** `audit_logs` contains **15,210 rows**; admin exposes `GET /api/admin/audit-logs` and `GET /api/admin/audit-logs/verify` (`admin.routes.js:31-36`).
- **Integrity formula:** each row's `row_hash = sha256(userId|action|entity|entityId|ip|prev_hash|ts)`, chained to the previous row under `pg_advisory_xact_lock(7891234)` (audit.js:48-92). Tampering breaks the chain → detectable by the verify endpoint.
- **Tests:** `admin.test.js` (58 cases) covers audit verify/hash chain; external script lists "Audit Integrity — Verify manually".
- **Confidence:** Coverage High; integrity High (hash chain verified in tests).

### 3.9 Data-at-rest encryption coverage
- **Formula:** `DeclaredToImplementedPgp% = (columns with an implemented encryption path ÷ columns declared encrypted) × 100`
- **Calculation:** **25 columns declared** `pgp_sym_encrypt at app layer` across 11 tables in `schema.sql`; **25 implemented** → `25 ÷ 25 × 100 = 100.0 %`
  - `023_at_rest_encryption.sql` — appointments reason/notes; incidents description; discharge_summaries final_diagnosis/treatment_summary/follow_up_notes/medications_on_discharge (7).
  - `024_medical_records_ot_notes_encryption.sql` (**new**) — `medical_records` chief_complaint/diagnosis/treatment_plan/notes + `ot_schedules` notes (5), backfilled in place with try-decrypt heuristic, matching the 023 pattern. Verified by `tests/integration/at-rest-encryption-r95.int.test.js` (raw DB rows are ciphertext; API returns plaintext).
  - Every declared column is now proven round-trip (ciphertext at rest → plaintext on decrypt) by `tests/integration/at-rest-encryption-sweep.int.test.js` (16 at-rest-encryption integration cases total).
  - App-layer `pgEncrypt`/`pgDecryptFields` already covered the remaining 13 — `users` email/phone, `patients` email/phone/address/emergency_contact, `prescriptions` instructions, `lab_results` result_data/interpretation, `visitors` visitor_name/visitor_phone/id_number, `blood_bank` description, telemedicine `recording_key`.
- **Client-side AES-256-GCM:** messages.content, notifications.title/body (schema.sql:405,421-422), file contents + `message_group_keys` (migration) — implemented in the app layer.
- **Assumption:** coverage % here counts only the pgp-declared column set (denominator = 25) for a conservative number; client-side AES-GCM raises effective coverage for messaging/notifications/files.
- **Confidence:** High (column comments + migration contents + app-layer search + integration tests asserting ciphertext-at-rest).
- **Deployment note:** `024` is applied automatically to the throwaway `hms_test` DB by the test global-setup; the **live `hms_db` still needs `npm run migrate`** to backfill the 5 columns.

### 3.10 Security control coverage summary
| Control | Covered / Total | % |
|---|---|---|
| Authentication (JWT + session) | 200 / 209 | 95.69 % |
| Authorization (RBAC) | 168 / 209 | 80.38 % |
| CSRF (non-GET) | 108 / 108 | 100 % |
| Rate limiting | 209 / 209 | 100 % |
| IP blocking | 209 / 209 | 100 % |
| Audit logging | 209 / 209 | 100 % |
| Ownership check | 16 / 209 | 7.66 % |
| Input validation (zod) | 146 / 209 | 69.86 % |

---

## 4. RBAC Metrics

Model: 19-value `user_role` enum (`server/src/db/schema.sql:66-71`); users linked via `user_roles`; enforcement via `authorize(...allowedRoles)` (`server/src/shared/middleware/rbac.js`), wildcard `'*'`, and assignment policy `ROLE_ASSIGNABILITY` (`server/src/modules/admin/admin.schema.js:34-47`).

### 4.1 Role definition vs assignment
| Metric | Formula | Calculation | Result |
|---|---|---|---|
| Roles defined | count enum | 19 | **19** |
| Roles assignable via UI/API | `USER_ROLES.length` | 18 (SUPER_ADMIN provisioned out-of-band) | **18** |
| Roles referenced in `authorize()` policies | distinct role strings in route files | 19 named roles (+`'*'`, +3 spread constants) | **19 / 19 = 100 % policy role coverage** |
| Roles assigned to ≥1 live user | `SELECT DISTINCT role FROM user_roles` | 13 roles / 20 users | **13 / 19 = 68.42 % utilization** |
| Unused roles (live DB) | defined − in-use | ADMIN, ANESTHETIST, DIETITIAN, ORDERLY, PHYSIO, RADIOLOGIST | **6** |

**Live role distribution (users by role, 2026-08-10):** PATIENT 6 · DOCTOR 3 · NURSE 1 · BILLING 1 · HR 1 · PHARMACIST 1 · SOCIAL_WORKER 1 · IT_ADMIN 1 · LAB_TECH 1 · SECURITY_OFC 1 · SUPER_ADMIN 1 · INVENTORY 1 · RECEPTIONIST 1 → 20 users.
**Note:** DIETITIAN and RADIOLOGIST are referenced in policy (diet-plans, lab-orders) but have no assigned user.

### 4.2 Role explosion ratio
- **Formula:** `RoleExplosionRatio = distinct roles in use ÷ total users` (i.e., average roles per user)
- **Calculation:** 13 roles ÷ 20 users = **0.65** (equivalently **1.00 roles per user**, since every user holds exactly one role row).
- **Source:** `user_roles` live query; single-role design in seed (`server/src/db/seed.js`).
- **Confidence:** High.

### 4.3 Least privilege compliance
- **Formula:** `LeastPrivilegeCompliance% = (restricted-by-policy assignments ÷ possible assignments) × 100`
- **Calculation:** `ROLE_ASSIGNABILITY` allows SUPER_ADMIN to assign all 18; ADMIN and HR can assign **17 each** (ADMIN excluded, admin.schema.js:44-47) → the privileged ADMIN role is grantable only by SUPER_ADMIN. Enforcement verified in `admin.schema.js:70` (`actorRoles.flatMap(ROLE_ASSIGNABILITY)`).
- **Result:** assignment is policy-restricted → **100 % of assignment paths are constrained**; no user has more than one role (no accumulation of privileges observed).
- **Assumption:** compliance is measured on the *assignment control*, not on runtime session privileges.
- **Confidence:** Medium-High (policy verified in code; runtime path not load-tested).

### 4.4 Permission / endpoint utilization
- **Formula:** `ProtectedEndpointCoverage% = (RBAC-gated endpoints ÷ total endpoints) × 100`
- **Calculation:** **168** RBAC-gated endpoints (154 inline `authorize(...)` + 12 routes reusing the shared `billing`/`admin`/`adminOrDoctor` instances in `billing.routes.js:26-27` & `analytics.routes.js:31` + 2 chatbot routes under module-level `authorize('PATIENT')` in `chatbot.routes.js`).
  - `168 ÷ 209 × 100 = 80.38 %` of all endpoints
  - `168 ÷ 200 × 100 = 84.00 %` of authenticated endpoints
- **Auth-only endpoints (32, no explicit role gate):** doctors directory (GET `/api/doctors`), notifications (8), messaging reads/membership (7), file metadata, etc. — read-only or self-scoped.
- **Confidence:** High (script audit; the 32 auth-only set enumerated).

---

## 5. Zero Trust Metrics

Zero-trust pillars mapped to implementation:

### 5.1 Verify explicitly
| Pillar | Evidence | Coverage |
|---|---|---|
| Identity | RS256 JWT, pinned alg + iss/aud, 5 verify sites | 200/209 (95.69 %) |
| Session | Per-request PostgreSQL `sessions` re-check; revoked → 401; DB down → **503 fail-closed** | 200/200 authenticated (100 %) |
| Device/context | IP + User-Agent fingerprint; drift flags `context_flagged_at` (migration 019), non-blocking signal | 100 % of authenticated requests (computed, non-blocking) |

### 5.2 Least privilege
- RBAC gates: 168 endpoints (80.38 %); ownership scoping on 16 (`checkOwnership`, `ownership.js`); role assignment restricted by `ROLE_ASSIGNABILITY`.

### 5.3 Assume breach
- Tamper-evident hash-chained audit (audit.js:48-92) + `pg_advisory_xact_lock(7891234)` serialization.
- Single-use rotating refresh tokens (auth.service.js:210-211, theft detection test `auth.test.js`).
- Fail-closed infrastructure: auth DB check 503, IP-block 503, auth rate-limit 503.
- Session revocation surfaces live: 190 sessions / 188 active.

### 5.4 Zero-trust coverage index (derived)
- **Formula:** `ZeroTrustCoverage% = (endpoints with all of [identity + live session check + fail-closed infra] ÷ total endpoints) × 100`
- **Calculation:** the 200 authenticated endpoints satisfy all three; public endpoints are intentionally exempt → `200 ÷ 209 × 100 = 95.69 %`; if RBAC is required too, `168 ÷ 209 = 80.38 %`.
- **Assumption:** the index is a conservative endpoint-share measure; device verification is non-blocking by design.
- **Confidence:** Medium (formula is ours; inputs High).

---

## 6. Performance Metrics

### 6.1 Live measurements (primary evidence)
Method: full login → 2FA (OTP read from Redis `2fa_otp:<userId>`) → verify → authenticated GET ×5 warmup + ×50 timed per endpoint, HTTP 200 confirmed on every sample, single dev machine, NODE_ENV=development.

| Endpoint | Mean | Median | P95 | Min | Max |
|---|---|---|---|---|---|
| `GET /health` | 3.76 ms | 2.43 ms | 8.07 ms | 1.60 ms | 24.33 ms |
| `GET /api/patients?limit=50` | 20.89 ms | 16.95 ms | 31.35 ms | 13.04 ms | 149.79 ms |
| `GET /api/departments` | 7.16 ms | 5.48 ms | 12.54 ms | 3.92 ms | 19.85 ms |
| `GET /api/admin/stats` | 4.71 ms | 4.53 ms | 5.81 ms | 3.68 ms | 7.05 ms |

- **Source of method:** measurement harness (login + Redis OTP + verify + timing), executed 2026-08-10 against the live dev server.
- **Assumption:** latencies are end-to-end on localhost (client → Express → PostgreSQL/Redis → response), single user, no concurrent load. They are indicative of steady-state, not capacity.

### 6.2 Stored/scripted values (secondary evidence)
- `benchmark.py` reports canned latencies `[0.76, 1.44, 2.19, 2.32] ms` rendered as `fig4_endpoint_response_time.png` — these are **hardcoded in source**, not re-measured live.
- `test.txt` documents an intended autocannon run: `autocannon -c 50 -d 30 http://localhost:5000/health` — **no output/stored results**.

### 6.3 Not-found performance metrics
| Metric | Value |
|---|---|
| Throughput (req/s) | **`NOT FOUND`** — no stored load-test output |
| Max concurrent users | **`NOT FOUND`** — no load/capacity test stored |
| P99 latency | **`NOT FOUND`** — existing tooling reports only mean/median/P95 |
| Authorization latency (isolated) | **`NOT FOUND`** — not measured in isolation |
| FAR / FRR | **`NOT FOUND`** — see §9 (no biometric/probabilistic authenticator) |

---

## 7. Database Metrics

### 7.1 Schema structure (live, measured 2026-08-10)
| Metric | Value | Formula |
|---|---|---|
| Tables | **59** | `information_schema.tables` (public schema, excl. `_migrations`) |
| Indexes | **204** | `pg_indexes` (incl. PK/unique-backed) |
| Foreign keys | **128** | `referential_constraints` |
| Primary keys | **59** | every table has one |
| Primary-key coverage | **100 %** | `59 ÷ 59` |
| Index coverage | **100 %** | `tables with ≥1 index (59) ÷ 59` |
| Index ratio | 3.46 / table | `204 ÷ 59` |
| FK ratio | 2.17 / table | `128 ÷ 59` |
| Enums | 1 | `user_role` (19 values) |
| Declared source structure | 58 tables · 124 `CREATE INDEX` · 138 FKs | `schema.sql` + 23 migrations |

> **Note on discrepancy:** the live DB (59 tables / 204 indexes / 128 FKs) differs from the declared source files (58 / 124 / 138) — the live DB includes constraint-backed indexes and reflects applied migrations; one additional table exists at runtime. Live values are authoritative for runtime behavior; source values describe intended schema.

### 7.2 Database security readiness (derived index)
- **Formula:** `DBSecurityScore = 100 × [0.30×(implemented_encrypted_cols ÷ declared_encrypted_cols) + 0.25×(audit hash-chain active:1) + 0.20×(per-request session revocation:1) + 0.15×(PK coverage) + 0.10×(index coverage)]`
- **Calculation:** `100 × [0.30×(25/25) + 0.25×1 + 0.20×1 + 0.15×(59/59) + 0.10×(59/59)] = 100 × 1.0 = 100 %`
- **Assumption:** weights are analyst-chosen (documented); the index is a derived roll-up, not an observed quantity.
- **Confidence:** Medium (inputs High, weights subjective).

### 7.3 Live data volume (context)
`users` 20 · `departments` 10 · `sessions` 190 (188 active) · `audit_logs` 15,210 · `blocked_ips` 0 · users with 2FA enabled 1 (5 %).

---

## 8. Test Metrics

### 8.1 Volume & health
| Metric | Value | Source |
|---|---|---|
| Test files | **62** (47 unit + 15 integration) | `ls server/tests` |
| Test cases (`it(`) | **783** | regex count; verified green `783 passed (783)` |
| Describe blocks | 224 | regex count |
| Skipped / focused | **0** (`it.skip/only/todo`) | regex count |
| Security-focused cases | **196** across 12 files | admin 58 · auth 38 · auth.middleware 13 · csprng 10 · rate-limiter 8 · at-rest-encryption 16 · ip-block 5 · ownership 17 · rbac 20 · validate 11 |
| Load / benchmark tests | **0** | none in vitest |

### 8.2 Coverage (measured via `npm run test:coverage`, 2026-08-10)
| Kind | Coverage |
|---|---|
| Statements | **61.34 %** (3560/5803) |
| Branches | **68.69 %** (1918/2792) |
| Functions | **58.85 %** (515/875) |
| Lines | **60.71 %** (3174/5228) |

**Phase-completed per-file gains (statement coverage):**
- `shared/middleware/rbac.js` — **100 %** (13/13 stmts, 8/8 branches) via `tests/rbac.test.js` (unit branches + real Express routes with RS256 JWTs + ROLE_ASSIGNABILITY boundaries).
- `shared/middleware/validate.js` — **100 %** (12/12 stmts, 8/8 branches) via `tests/validate.test.js` (422 failures, coercion, field replacement, unknown-key stripping, parsedQuery).
- `shared/middleware/ownership.js` — **100 %** (27/27 stmts, 14/15 branches) via `tests/ownership.test.js`; includes an end-to-end billing IDOR route test that fails (200 instead of 403) when `checkOwnership('bill')` is removed — verified during the measurement run.
- `shared/middleware` aggregate **83.62 %** (was ~50 %); `ot.service.js` 99.13 %, `telemedicine.service.js` 100 %, `patient.service.js` 91.83 %.

**Remaining low-coverage areas:** `email.service.js`, `corsOriginCheck.js`, most `*.controller.js` (service-level tests mock them), `redis.service.js` 35.55 %, `pgcrypto.js` 42.85 % (integration tests exercise it via the real DB but the module's own branches are partially uncovered).

**Effectiveness evidence:** the suite caught a real regression during this measurement — `auth.service.js:224` contained `console.log("JWT ALGORITHM:", jwt.decode(accessToken, ...))` with an undefined `accessToken`, throwing `ReferenceError` in `refresh()` (3 failing tests: refresh rotation, inactive-user 401, theft detection). The line was removed; **722/722 pass again**. This validates the refresh/rotation tests (`auth.test.js`).

---

## 9. Research Paper Metrics

| Metric | Value | Formula / evidence |
|---|---|---|
| Unauthorized Access Blocking Rate | **100 %** (within test scope) | All tested bypass attempts rejected: fake JWT → 401, invalid login → 401, missing CSRF → 403, revoked/inactive session → 401, ownership violation → 403 (tests `auth.middleware.test.js`, `ip-block.test.js`, `ownership.test.js`, live `security_validation.py`). No bypass found. Confidence: Medium (coverage of enforcement paths partial) |
| FAR (False Acceptance Rate) | **`NOT FOUND`** | No biometric/probabilistic authenticator. Auth is deterministic (RS256 signature + session DB row). An attacker cannot be "falsely accepted" without possessing a valid key/secret; no empirical FAR measurement exists |
| FRR (False Rejection Rate) | **`NOT FOUND`** | No measurement; valid-token flows succeed in tests/live (fresh tokens always accepted) |
| Role Assignment Accuracy | **100 %** (assignment policy) | `ROLE_ASSIGNABILITY` restricts grants (only SUPER_ADMIN may grant ADMIN); enforcement in `admin.schema.js:70`. Note: "accuracy" here = policy conformance; role *utilization* is 68.42 % |
| Least Privilege Compliance | **100 %** of assignment paths constrained; 6/19 roles unused live | see §4.3 |
| Authorization Latency | **`NOT FOUND`** | Not isolated; included in end-to-end latencies (§6.1) |
| Average Response Time | /health 3.76 · patients 20.89 · departments 7.16 · admin/stats 4.71 ms | live measurement §6.1 |
| Throughput | **`NOT FOUND`** | no load test stored |
| JWT Validation Rate | **100 %** | all 5 verify sites pin RS256 + iss/aud |
| CSRF Protection Rate | **100 %** | 108/108 non-GET endpoints behind `doubleCsrf` |
| Audit Logging Coverage | **100 %** | 209/209 endpoints auto-audited; 15,210 live entries |
| Zero Trust Coverage | **95.69 %** (identity+session+fail-closed) / **80.38 %** (incl. RBAC) | §5.4 |

---

## 10. Visualization Data

Raw CSV blocks ready for charting (all values measured 2026-08-10).

### 10.1 Chart 1 — System security coverage (%)
```csv
control,covered,total,pct
Authentication (JWT+session),200,209,95.69
Authorization (RBAC),168,209,80.38
CSRF (non-GET),108,108,100
Rate limiting,209,209,100
IP blocking,209,209,100
Audit logging,209,209,100
Input validation (zod),146,209,69.86
Ownership check,16,209,7.66
```

### 10.2 Chart 2 — RBAC role distribution (live users)
```csv
role,users
PATIENT,6
DOCTOR,3
NURSE,1
BILLING,1
HR,1
PHARMACIST,1
SOCIAL_WORKER,1
IT_ADMIN,1
LAB_TECH,1
SECURITY_OFC,1
SUPER_ADMIN,1
INVENTORY,1
RECEPTIONIST,1
```

### 10.3 Chart 3 — Endpoint protection coverage (counts)
```csv
protection_layer,endpoints_covered,total_endpoints
Authenticated,200,209
RBAC gated,168,209
Ownership checked,16,209
Validated (zod),146,209
Audited,209,209
CSRF protected (non-GET),108,108
Rate limited,209,209
IP blocked,209,209
```

### 10.4 Chart 4 — Performance evaluation (live, ms)
```csv
endpoint,mean_ms,median_ms,p95_ms,min_ms,max_ms
GET /health,3.76,2.43,8.07,1.60,24.33
GET /api/patients?limit=50,20.89,16.95,31.35,13.04,149.79
GET /api/departments,7.16,5.48,12.54,3.92,19.85
GET /api/admin/stats,4.71,4.53,5.81,3.68,7.05
```

### 10.5 Chart 5 — Throughput vs concurrent users
```csv
concurrent_users,throughput_req_per_s
NOT FOUND,NOT FOUND
```
*(No load test was executed or stored. Chart placeholder; do not render as data.)*

### 10.6 Chart 6 — Security validation results (external black-box, live run)
```csv
mechanism,scenario,expected,observed
User Authentication,Valid login credentials,Access granted,Passed
User Authentication,Invalid credentials,Access denied,Passed
JWT Token Validation,Expired/invalid token,Request rejected,Passed
CSRF Protection,Request without valid CSRF token,Request blocked,Passed
Rate Limiting,Excessive requests from same client,Requests throttled,Not Triggered*
Role-Based Access Control,Unauthorized role accessing protected resource,Access denied,Manual Verification Required
Resource Ownership,User accessing another user's records,Access denied,Manual Verification Required
Audit Logging,Security-sensitive action performed,Audit record created,Verify audit table manually
Audit Integrity,Modified audit record,Tampering detected,Verify manually
Session Management,Revoked session token,Access denied,Manual Verification Required
```
\* The script targets `/health`, which is intentionally outside the `/api` rate limiter.

---

## 11. Evidence Appendix

### Source files (paths, relative to repo root)
- `server/src/app.js` — middleware order (rate-limit 127, ipBlock 132, audit 135, CSRF 141-158, csrf-token 186, mounts 189-220, health 223).
- `server/src/shared/middleware/{auth,rbac,ownership,audit,rateLimiter,validate,ipBlock}.js`
- `server/src/modules/auth/auth.service.js` (login 133-136 requires2fa; refresh 196-234; 2FA 497-687), `auth.controller.js` (login 16-44), `auth.routes.js` (32-49).
- `server/src/modules/admin/admin.schema.js` (USER_ROLES 37-39, ROLE_ASSIGNABILITY 44-47, guard 70).
- `server/src/db/schema.sql` (enum 66-71; encryption comments 52-53, 128-131, 181-182, 201-204, 302, 316, 348-350, 405, 421-422, 582, 637, 675, 693-697, 737-742).
- `server/src/db/migrations/023_at_rest_encryption.sql`; migration 019 (`context_flagged_at`).
- Socket JWT verify: `server/src/socket.js`, `server/src/modules/{messaging,notifications,telemedicine}/*.socket.js`.
- Tests: `server/tests/*.test.js` (43), `server/tests/integration/*.int.test.js` (14).
- Root tooling: `performance_analysis.py`, `benchmark.py`, `test.txt`, `security_validation.py`, `jwt_migration.md`.

### Key evidence values (measured 2026-08-10)
- Endpoint audit (python block-parser over 32 route files): 209 endpoints; 200 auth / 9 public; 168 RBAC; 16 ownership; 146 validate; 108 non-GET.
- Live DB: 20 users · 13/19 roles in use · 190 sessions (188 active) · 10 departments · 15,210 audit rows · 0 blocked IPs · 59 tables · 204 indexes · 128 FKs · 59 PKs.
- Live HTTP perf: §6.1. External security script output: §10.6.
- Test suite: 722/722 pass (57 files), coverage §8.2. `npm run test:coverage` (2026-08-10).

### Change made during measurement
- Removed a stray debug statement (`console.log("JWT ALGORITHM:", jwt.decode(accessToken, ...))`) at `server/src/modules/auth/auth.service.js:224` that referenced an undefined variable and broke the token-refresh path. Verified: `Tests 722 passed (722)`. **Not committed.**

### Assumptions & limitations
- All measurements are development-environment, single-node; production numbers will differ.
- Composite indices (§5.4, §7.2) use analyst-chosen weights; raw inputs are the authoritative evidence.
- Encryption coverage % (§3.9) is a conservative declaration-based measure; client-side AES-GCM is real but excluded from the 25-column denominator.
- `NOT FOUND` entries are deliberate — see §6.3 and §9.
