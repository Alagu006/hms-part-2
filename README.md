# Hospital Management System (HMS)

Full-stack HMS built with Node.js / Express, PostgreSQL, Redis, React, and Socket.io.

---

## Prerequisites

- Docker & Docker Compose v2
- Node.js 20+ (for local dev without Docker)
- An RSA-256 key pair for JWT signing

---

## 1. Generate JWT Keys

```bash
mkdir -p secrets
openssl genrsa -out secrets/jwt_private.pem 4096
openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem
```

---

## 2. Environment Variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `DB_NAME` | yes | PostgreSQL database name (default: `hms`) |
| `DB_USER` | yes | PostgreSQL user (default: `hms_user`) |
| `DB_PASSWORD` | yes | PostgreSQL password |
| `DB_HOST` | yes | DB host (default: `localhost`) |
| `DB_PORT` | no | DB port (default: `5432`) |
| `DB_POOL_MAX` | no | Max PG pool connections (default: `20`) |
| `DB_SSL` | no | `true` to enable SSL |
| `REDIS_HOST` | yes | Redis host (default: `localhost`) |
| `REDIS_PORT` | no | Redis port (default: `6379`) |
| `REDIS_PASSWORD` | yes | Redis password |
| `JWT_PRIVATE_KEY_PATH` | yes | Path to RSA private key PEM |
| `JWT_PUBLIC_KEY_PATH` | yes | Path to RSA public key PEM |
| `JWT_ISSUER` | no | JWT issuer claim (default: `hms`) |
| `JWT_AUDIENCE` | no | JWT audience claim (default: `hms-client`) |
| `DB_ENCRYPTION_KEY` | yes | 32-byte hex key for pgcrypto field encryption |
| `VAPID_PUBLIC_KEY` | yes | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | yes | Web Push VAPID private key |
| `VAPID_SUBJECT` | yes | VAPID contact email (`mailto:...`) |
| `CLIENT_ORIGIN` | yes | React app origin for CORS (e.g. `http://localhost:5173`) |
| `PORT` | no | API server port (default: `4000`) |
| `FILE_STORAGE_PATH` | no | Disk path for encrypted file uploads (default: `./uploads`) |
| `MAX_FILE_SIZE_BYTES` | no | Max upload size in bytes (default: `20971520` = 20 MB) |
| `OPENAI_API_KEY` | yes | OpenAI key for patient chatbot |
| `AWS_REGION` | no | AWS region for S3 report storage |
| `AWS_S3_BUCKET` | no | S3 bucket name for reports |
| `SEED_ADMIN_PASSWORD` | no | Override default SUPER_ADMIN password during seeding |
| `SLOW_QUERY_THRESHOLD_MS` | no | Log queries slower than this (default: `500`) |

### Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

### Generate DB encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Run with Docker Compose

```bash
# Start all services (Postgres, Redis, API server, React dev server)
docker compose up --build

# Run in background
docker compose up -d --build

# View logs
docker compose logs -f server
```

The API will be available at `http://localhost:4000` and the React app at `http://localhost:5173`.

---

## 4. Database Setup & Seeding

The schema is applied automatically by Docker on first run via `docker-entrypoint-initdb.d`.

To seed default data (departments, SUPER_ADMIN, message groups, medicines):

```bash
# Inside Docker
docker compose exec server node src/db/seed.js

# Or locally (with .env loaded)
node server/src/db/seed.js
```

Default SUPER_ADMIN credentials:
- Employee ID: `SA001`
- Password: value of `SEED_ADMIN_PASSWORD` env var (default: `Admin@12345!`)

**Change this password immediately after first login.**

---

## 5. Local Development (without Docker)

```bash
# Install server dependencies
cd server && npm install

# Install client dependencies
cd client && npm install

# Start API server (watches for changes)
cd server && npm run dev

# Start React dev server
cd client && npm run dev
```

---

## 6. Running Migrations

Migration files in `server/src/db/migrations/` are applied in filename order. To apply manually:

```bash
psql -U $DB_USER -d $DB_NAME -f server/src/db/migrations/004_clinical_modules.sql
psql -U $DB_USER -d $DB_NAME -f server/src/db/migrations/005_billing_module.sql
psql -U $DB_USER -d $DB_NAME -f server/src/db/migrations/005_report_jobs.sql
```

---

## 7. Architecture Overview

```
client/          React + Vite SPA
  src/
    App.jsx              React Router + role-based guards
    modules/             Feature modules (admin, doctor, nurse, …)
    shared/
      store/index.js     Zustand store (auth, notifications, messaging)
      hooks/             useNotifications, etc.
      components/        Encrypted file upload/download
      utils/             crypto, inactivity helpers

server/
  src/
    app.js               Express app + middleware stack
    socket.js            Socket.io init + namespace registration
    modules/             20 feature modules (routes, controllers, services)
    shared/
      middleware/        auth, rbac, rateLimiter, audit, validate
      db/                pool.js, redis.js
      services/          notification, webpush, redis
    db/
      schema.sql         Full PostgreSQL schema
      migrations/        Incremental migration files
      seed.js            Seed script
```

---

## 8. API Base URL

All REST endpoints are prefixed with `/api`:

| Prefix | Module |
|---|---|
| `/api/auth` | Login, refresh, logout, OTP |
| `/api/patients` | Patient CRUD + timeline |
| `/api/prescriptions` | Prescriptions + dispense |
| `/api/vitals` | Vitals recording |
| `/api/discharge-summaries` | Discharge summaries |
| `/api/bills` | Billing + insurance |
| `/api/inventory` | Inventory + beds + QR |
| `/api/blood-bank` | Blood bank |
| `/api/ot-schedules` | OT scheduling |
| `/api/telemedicine` | Telemedicine sessions |
| `/api/messaging` | Group messaging REST |
| `/api/notifications` | Notifications + Web Push |
| `/api/broadcasts` | Admin broadcasts |
| `/api/leaves` | Leave management |
| `/api/incidents` | Incident reports |
| `/api/analytics` | Analytics + reports |
| `/api/files` | Encrypted file upload/download |
| `/api/chatbot` | Patient AI chatbot |
| `/api/admin` | Admin panel (users, audit, sessions) |

## 9. Socket.io Namespaces

| Namespace | Purpose |
|---|---|
| `/notifications` | Real-time notification push |
| `/messaging` | Group chat, typing indicators, presence |
| `/telemedicine` | WebRTC signaling, in-call chat |

All namespaces require a valid JWT passed as `socket.handshake.auth.token`.
