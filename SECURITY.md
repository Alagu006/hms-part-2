# Security Posture

The HMS runs as a **single Node.js/Express monolith** — HTTP API, Socket.io, and BullMQ
workers all in one process — serving 183 HTTP endpoints and 12 Socket.io handlers across
19 RBAC roles. This document states honestly which Zero Trust principles are **applied
today** and which are **deliberately deferred to a service split**, so the gap is a
conscious, documented tradeoff rather than an accident.

See [`.kiro/specs/zero-trust-security/`](.kiro/specs/zero-trust-security/) for the full
requirements and audit that drove Phases 1–5.

---

## Applied today

The system enforces Zero Trust at the **application boundary**: every request is
authenticated, authorized, throttled, audited, and validated, and the database access is
least-privilege.

### Authentication & sessions
- **RS256 JWT** access tokens with a **15-minute** TTL (`auth.service.js`), verified against
  the private/public key pair loaded from disk (`JWT_PRIVATE_KEY_PATH` /
  `JWT_PUBLIC_KEY_PATH`), with enforced `issuer` and `audience`.
- **Per-request session revocation check** (`middleware/auth.js`): every request with a
  `sessionId` is validated against the `sessions` table, so a revoked session is rejected
  **within seconds, not the token lifetime**. Missing → 401 "Session not found",
  revoked → 401 "Session revoked", no `sessionId` claim → 401 "Missing session ID".
- **Fail-closed**: if the session lookup cannot be completed (DB unreachable), the request
  is rejected with **503** rather than allowed through unchecked.
- **Session context signal**: IP and user-agent are hashed (sha256, 16-char) at login and
  compared per request; a change logs `SESSION_CONTEXT_CHANGE` and flags
  `sessions.context_flagged_at` once (non-blocking, `019_session_context_flag.sql`).
- **Refresh tokens** are opaque, single-use (rotated on every refresh), stored in Redis with
  a 7-day TTL, and flushed by the midnight cron. **DB revocation is authoritative**; Redis
  cleanup is best-effort.
- **2FA** via email OTP (`twofa_enabled`), OTP TTL 10 minutes.
- **Account lockout**: 5 failed logins / 15 min per IP+username; further attempts are
  rejected with 429, and the lockout triggers a notification to the user and SUPER_ADMIN.

### Authorization
- **RBAC** via `authorize(...roles)` (`middleware/rbac.js`) on top of JWT role claims, with
  role-specific route scoping across all modules.
- **Ownership enforcement** (`middleware/ownership.js`) for the `PATIENT` role on
  patient/prescription/bill/medical_record/lab_result/appointment resources — 404 for
  missing resources, 403 for non-owners. Billing endpoints require explicit roles
  (PATIENT/BILLING/RECEPTIONIST/ADMIN/SUPER_ADMIN), not wildcard access.
- **IP block list** gate on all `/api` requests (`middleware/ipBlock.js`). **Redis is only a
  cache** — the `blocked_ips` table in Postgres is the source of truth. When the cache is
  unavailable `isIpBlocked()` reads Postgres directly (`admin.service.js`), so a Redis blip
  does **not** take the app down and every request still gets a real block-list check.
  **Fail-closed (503) only when the block list cannot be determined by any means** — i.e. the
  Postgres check itself fails (at which point the app is down anyway).
- **Role provisioning is privilege-scoped** (`modules/admin`): `POST /admin/users` validates
  `role` against a **per-actor allow-list** (`ROLE_ASSIGNABILITY` in `admin.schema.js`), not
  a single global enum. **HR/ADMIN can only grant clinical and staff roles**; the **ADMIN
  role can be granted only by a SUPER_ADMIN**, enforced at schema validation and re-checked
  in `admin.service.js` against the DB (403). `SUPER_ADMIN` itself is provisioned out-of-band
  (seed / direct DB), never via the API. `updateUser` cannot change roles at all — it has no
  `role` field and there is no separate role-assignment endpoint, so `createUser` is the only
  role-grant path.

### Least-privilege database access
- Three PostgreSQL roles (`db/setup-roles.js`, verified by `npm run db:verify`):
  - `hms_api` — the running API's role. **DML only** (SELECT/INSERT/UPDATE/DELETE); **no
    DDL, no ownership, no superuser**. Postgres itself rejects `CREATE/DROP` as `hms_api`.
  - `hms_migrator` — used **only** by `npm run migrate`, which connects with explicit
    `DB_MIGRATOR_*` credentials and no `DB_PASSWORD` fallback (`db/migrate.js`).
  - `hms_readonly` — optional SELECT-only role for analytics/reporting.
- Default privileges auto-grant any future migrator-created table to `hms_api` /
  `hms_readonly`, so the boundary holds as the schema grows.

### Data protection
- **Field-level PII encryption** with pgcrypto `pgp_sym_encrypt` / `pgp_sym_decrypt`
  (`shared/db/pgcrypto.js`), key from `PG_CRYPTO_KEY`.
- **Argon2id** password hashing (`memoryCost: 65536, timeCost: 3, parallelism: 4`).
- **CSPRNG everywhere**: OTPs via `crypto.randomInt`, temporary passwords via
  `crypto.randomBytes(16).toString('base64url')`, group keys via `crypto.randomBytes(32)`,
  rate-limiter nonces via `crypto.randomBytes(8)`. No `Math.random()` in security paths.
- **Secrets never in URLs**: the Gemini API key is sent via the `x-goog-api-key` header, not
  a query parameter.
- **Fail-fast startup**: missing `DB_*`, `JWT_*`, `PG_CRYPTO_KEY`, `DB_ENCRYPTION_KEY`, or
  `CSRF_SECRET` aborts startup instead of running insecurely.

### Request hardening
- **CSRF double-submit** (`csrf-csrf`): `__Host-`-prefixed cookie in production,
  `httpOnly`, `sameSite: strict`, 64-byte token via `x-csrf-token` header, all mutating
  methods protected.
- **Rate limiting** (`middleware/rateLimiter.js`, Redis sliding window): auth 20/15 min,
  login 5/15 min per IP+username, OTP 10/15 min — all **fail-closed** (503 on Redis
  outage); general API 200/min is deliberately **fail-open** (DoS mitigation, not an auth
  control). Contrast with the IP-block gate above: rate limiting fails closed **only on auth
  routes** (where unthrottled brute-force would matter), whereas the IP block list fails
  closed **on every route** because letting a request through an uncheckable block list is a
  hard security failure, not a throttling miss.
- **Security headers** (`helmet` in `app.js`): CSP `default-src 'self'`, HSTS
  `max-age=31536000; includeSubDomains; preload` (production only), `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy` blocking
  camera/microphone/geolocation/payment, `COOP: same-origin`, `CORP: same-origin`.
- **CORS allowlist** via `corsOriginCheck` (HTTP and Socket.io), `credentials: true`.
- **Input hygiene**: 2 MB body limit, control-character/null-byte stripping,
  Zod-schema validation on route bodies, dedicated 5/15-min limiter on the public contact
  route.
- **`trust proxy`** defaults to `loopback` in development (never blindly trusts
  `X-Forwarded-For`).

### Client-side session storage (stated tradeoff)
- The RS256 **access token is persisted to `sessionStorage`** (key `hms-auth`) by the Zustand
  `persist` middleware — the **single writer** — and a synchronous hydrate at startup
  (`client/src/shared/store/index.js`) makes it available to the API interceptor
  (`shared/utils/api.js`) before middleware rehydration. This is what keeps the session alive
  across a page refresh **without re-running the refresh-token flow**.
- **Deliberate tradeoff, not an oversight**: `sessionStorage` is readable by any script in
  the page, so a successful XSS could exfiltrate the token. Exposure is bounded — the access
  token has a 15-minute TTL; the **refresh token never touches browser storage** (it is an
  `httpOnly`, `sameSite: strict` cookie — `hms_refresh`, path `/api/auth`, rotated on every
  use); and `sessionStorage` is per-tab and cleared when the tab closes (unlike
  `localStorage`).
- Moving the token to **memory-only** state and rehydrating it from the refresh-token flow on
  every page load was evaluated and **not adopted**: it would turn every refresh into a
  network round-trip to the refresh endpoint and change refresh behavior. Recorded here so it
  is a stated tradeoff rather than an undocumented gap.

### Audit & logging
- **Tamper-evident audit log** (`middleware/audit.js`): every entry stores the
  SHA-256 of `userId|action|entity|entityId|ip|prevHash|timestamp`, chaining to the
  previous `row_hash`, serialized under a Postgres advisory lock.
- **Structured Winston logging** (JSON, with `timestamp/level/message/service/requestId`)
  replaces `console.*` in production-path code; request IDs are attached to every request.
- **Process resilience**: unhandled rejections/exceptions are logged and the process
  continues so fail-closed middleware can keep returning 503s instead of the server dying.

---

## Would require splitting into services

The following Zero Trust pillars are **not** achievable in-process and are **deliberately
not claimed**. A split is a conscious engineering decision, not a forgotten gap.

| Control | Why a split is required |
|---|---|
| **Network segmentation** | Per-service network policies / VLANs / firewalls require separate deployables. Today the API, Socket.io, and workers share one process and one network address. |
| **Mutual TLS (mTLS) between components** | Transport-level identity between API ↔ workers ↔ DB requires each component to present its own certificate. Today components trust the process boundary. |
| **Service-to-service authentication** | A standalone worker (or any future service) needs its own signed token / API key to prove identity when calling peers. Today one process is one identity. |
| **Independent blast radius** | A dependency compromise in any single module is a compromise of the whole process. Separate processes confine it to one service. |
| **Per-component credentials & secrets** | Workers currently share the app's DB credentials and env secrets (see `WORKER_CREDENTIALS.md`). Real per-service credentials need separate runtimes. |
| **Per-service rate limiting & quotas** | Limiting is keyed per request today; per-service admission control needs an independent enforcement point per service. |

**Tradeoff:** the monolith achieves strong Zero Trust *at its boundary* — every request is
individually verified and the database is least-privilege. What it cannot do is establish
*trust between its own internal components* at the transport layer; that requires
decomposition.

### First split candidate: the PDF worker
The **PDF report generator** is the natural first service to split, because it is already
cleanly isolated:
- Self-contained module (`shared/jobs/worker-handlers.js` + `workerConfig.js`), driven by
  BullMQ over Redis — a clean interface to externalize.
- The only component with a heavyweight browser dependency (Puppeteer) and a distinct
  failure mode (`PDF_UNAVAILABLE`), so it benefits most from isolation.
- Its job queue provides a natural auth boundary: a split worker would be secured with
  **mTLS or signed service tokens** plus its own least-privilege DB credentials, instead of
  the shared in-process identity it has today.

Worker credentials and scoping are documented in
[`WORKER_CREDENTIALS.md`](WORKER_CREDENTIALS.md).

---

## Verification

- `npm run db:verify` — asserts the least-privilege DB roles end-to-end (DDL rejected by
  Postgres for `hms_api`, DML smoke tests, migrator/readonly controls).
- `npm test` — 645 tests across 39 files, including session-revocation, refresh-replay,
  worker, UUID-validity, and role-assignability coverage.
- `npm run verify:workers` — live end-to-end worker credential/scope check.
