# City General Hospital Hospital Management System (HMS)

A full-stack, role-based hospital management system built as a college project. It covers patient registration, appointments, telemedicine, electronic health records, billing, pharmacy, lab management, inventory, and more — all backed by a fine-grained RBAC system with 19 roles.

---

## Tech Stack

| Layer      | Technology                                              |
|------------|---------------------------------------------------------|
| Frontend   | React 18 + Vite, React Router 6, TanStack Query v5     |
| Backend    | Node.js + Express (ES Modules)                          |
| Database   | PostgreSQL 16 + pgcrypto (field-level encryption)       |
| Cache/Queue| Redis 7 + BullMQ                                        |
| Auth       | JWT RS256 (asymmetric), Argon2id, CSRF tokens           |
| Realtime   | Socket.io (WebSocket)                                   |
| Payments   | Razorpay (test mode)                                    |
| Email      | Nodemailer (SMTP, Mailhog in dev)                       |
| File Store | Local filesystem with AES-256-GCM client-side encrypt  |
| AI         | Gemini / OpenAI / Ollama (configurable per request)     |

---

## How to Run Locally

### Prerequisites

- **Node.js** 18 or higher
- **Docker** and **Docker Compose**

### 1. Environment setup

```bash
cp server/.env.example server/.env
```

In `server/.env`, fill in the required secrets:
- `PG_CRYPTO_KEY` — any 32-character string for PostgreSQL field-level encryption
- `DB_ENCRYPTION_KEY` — any 32-character string for database field encryption

Generate a 32-byte hex key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. JWT key generation

The server uses RS256 (asymmetric) JWT signing. Generate a key pair:

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Move the keys into `server/secrets/`:

```bash
mkdir -p server/secrets
mv private.pem server/secrets/jwt_private.pem
mv public.pem  server/secrets/jwt_public.pem
```

### 3. Start infrastructure services

```bash
docker-compose up -d
```

This starts PostgreSQL (port 5555), Redis (port 6379), and Mailhog (port 1025 for SMTP, port 8025 for web UI).

### 4. Start the server

```bash
cd server && npm install && npm run dev
```

The API runs on **http://localhost:4000**.

### 5. Start the client

```bash
cd client && npm install && npm run dev
```

Open **http://localhost:5173** in your browser.

### 6. Seed the database

On first run, seed the database with departments and the super admin account:

```bash
node server/src/db/seed.js
```

### Default Super Admin credentials

| Field    | Value                  |
|----------|------------------------|
| Email    | `admin@hospital.local` |
| Password | `ChangeMe123!`         |

> Change this password after first login.

### Email testing

All outgoing emails (appointment confirmations, OTPs, billing receipts, etc.) are captured by Mailhog. View them at:

**http://localhost:8025**

For local SMTP delivery, configure in `server/.env`:

```
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
```

---

## All 19 RBAC Roles

| #  | Role             | Code             |
|----|------------------|------------------|
| 1  | Super Admin      | `SUPER_ADMIN`    |
| 2  | Admin            | `ADMIN`          |
| 3  | Doctor           | `DOCTOR`         |
| 4  | Nurse            | `NURSE`          |
| 5  | Receptionist     | `RECEPTIONIST`   |
| 6  | Lab Technician   | `LAB_TECH`       |
| 7  | Pharmacist       | `PHARMACIST`     |
| 8  | Inventory Manager| `INVENTORY`      |
| 9  | Radiologist      | `RADIOLOGIST`    |
| 10 | Billing Staff    | `BILLING`        |
| 11 | HR Manager       | `HR`             |
| 12 | Dietitian        | `DIETITIAN`      |
| 13 | Physiotherapist   | `PHYSIO`         |
| 14 | Anaesthetist     | `ANESTHETIST`    |
| 15 | Social Worker    | `SOCIAL_WORKER`  |
| 16 | IT Admin         | `IT_ADMIN`       |
| 17 | Security Officer | `SECURITY_OFC`   |
| 18 | Orderly          | `ORDERLY`        |
| 19 | Patient          | `PATIENT`        |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                        │
│   ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│   │ React Router │   │ TanStack Q  │   │ Socket.io Client   │  │
│   │  (routing)   │   │  (queries)  │   │  (realtime events) │  │
│   └──────────────┘   └──────────────┘   └────────────────────┘  │
│   Auth state: Zustand store + sessionStorage JWT                 │
└─────────────────────────────┬────────────────────────────────────┘
                              │ HTTP + WebSocket
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                         API Server (Express)                     │
│  ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────┐  │
│  │  Routers  │ │ Middleware  │ │  Services  │ │  Workers   │  │
│  │ (19 RBAC) │ │ (JWT/CORS)  │ │  (domain)  │ │ (BullMQ/Q) │  │
│  └────────────┘ └─────────────┘ └────────────┘ └────────────┘  │
│  ┌────────────┐ ┌─────────────┐ ┌────────────┐                  │
│  │ Web Push   │ │ Socket.io  │ │  Email     │                  │
│  │ (VAPID)    │ │  (server)  │ │(Nodemailer)│                  │
│  └────────────┘ └─────────────┘ └────────────┘                  │
│  File encryption: AES-256-GCM (client-side)                      │
│  DB encryption:   pgcrypto (server-side fields)                 │
└──────┬─────────────────────┬───────────────────────┬────────────┘
       │                     │                       │
       ▼                     ▼                       ▼
┌──────────────┐    ┌──────────────┐       ┌──────────────┐
│  PostgreSQL   │    │    Redis     │       │   SMTP /     │
│  (primary DB) │    │(cache/queue) │       │  Mailhog     │
│  Port 5555   │    │  Port 6379   │       │  Port 1025   │
└──────────────┘    └──────────────┘       └──────────────┘
```

### Request flow

1. Browser loads React SPA → `TanStack Query` fetches initial data
2. JWT stored in `sessionStorage` → sent as `Authorization: Bearer <token>` header
3. Express middleware validates JWT RS256 signature using public key
4. RBAC middleware checks role permissions against route guard config
5. Service layer handles business logic, reads/writes PostgreSQL
6. Async jobs (email, push notifications, report generation) are enqueued to BullMQ → processed by Redis-backed workers
7. Socket.io broadcasts real-time events (telemedicine, messaging, notifications)
8. File uploads are AES-256-GCM encrypted client-side before transmission; decryption keys stored in browser `sessionStorage`

### Key domain modules

- **Patient** — registration, appointments, prescriptions, billing, timeline
- **Doctor** — scheduling, prescriptions, discharge, EHR, OPD
- **Nurse** — vitals recording, ward assignments, handover notes
- **Pharmacy** — dispensing, stock management
- **Lab** — sample tracking, result reporting
- **Billing** — generate bills, Razorpay payments, financial reports
- **Inventory** — bed management, QR codes, stock tracking
- **Telemedicine** — WebRTC via PeerJS + Socket.io, end-to-end encrypted chat
- **Messaging** — encrypted group messaging across roles
- **Notifications** — browser Web Push + in-app bell
- **AI Chatbot** — Gemini / OpenAI / Ollama-powered patient assistant
- **File Storage** — client-side encrypted uploads, PDF downloads
