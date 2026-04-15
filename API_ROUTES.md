# City General Hospital — HMS API Reference

> **Total: 183 HTTP endpoints + 12 Socket.io event handlers = 195 total**
>
> Every route follows this middleware pipeline:
> `Rate Limiter → authenticate (JWT RS256) → authorize (RBAC) → validate (Zod) → Controller → Audit Log`

---

## Summary Table

| Module | Base Path | Routes | Description |
|--------|-----------|--------|-------------|
| Auth | `/api/auth` | 10 | Login, logout, OTP, sessions |
| Admin | `/api/admin` | 15 | User management, audit logs, IP blocking |
| Analytics | `/api/analytics` | 8 | Stats, reports, dashboards |
| Appointments | `/api/appointments` | 5 | Scheduling, status updates |
| Billing | `/api/billing` | 16 | Bills, payments, insurance, Razorpay |
| Blood Bank | `/api/blood-bank` | 7 | Blood units, requests, availability |
| Broadcast | `/api/broadcast` | 5 | System-wide announcements |
| Case Notes | `/api/case-notes` | 3 | Social worker patient notes |
| Chatbot | `/api/chatbot` | 2 | AI patient assistant |
| Departments | `/api/departments` | 3 | Department CRUD |
| Diet Plans | `/api/diet-plans` | 3 | Dietitian meal plans |
| Discharge | `/api/discharge` | 2 | Discharge summaries |
| Doctors | `/api/doctors` | 1 | Doctor directory |
| Files | `/api/files` | 8 | Encrypted file upload/download |
| Handover Notes | `/api/handover-notes` | 3 | Nurse shift handovers |
| Incidents | `/api/incidents` | 2 | Safety incident reporting |
| Inventory | `/api/inventory` | 15 | Stock, beds, QR codes |
| Lab Orders | `/api/lab-orders` | 6 | Lab tests, results |
| Leaves | `/api/leaves` | 7 | Leave requests, approvals |
| Messaging | `/api/messaging` | 12 | Encrypted group/DM chat |
| Notifications | `/api/notifications` | 8 | In-app + Web Push |
| Nurse Assignments | `/api/nurse-assignments` | 1 | Ward assignments |
| OT Scheduling | `/api/ot-scheduling` | 5 | Operating theatre calendar |
| Patients | `/api/patients` | 8 | Registration, records, timeline |
| Prescriptions | `/api/prescriptions` | 12 | Medicines, prescriptions, dispensing |
| Shifts | `/api/shifts` | 3 | Staff shift scheduling |
| Telemedicine | `/api/telemedicine` | 4 | Video consultation sessions |
| Visitors | `/api/visitors` | 5 | Visitor check-in/out |
| Vitals | `/api/vitals` | 3 | Patient vitals recording |
| **TOTAL** | | **183** | |

---

## RBAC — 19 Roles

| Code | Role |
|------|------|
| `SUPER_ADMIN` | Super Administrator |
| `ADMIN` | Administrator |
| `DOCTOR` | Doctor |
| `NURSE` | Nurse |
| `RECEPTIONIST` | Receptionist |
| `LAB_TECH` | Lab Technician |
| `PHARMACIST` | Pharmacist |
| `INVENTORY` | Inventory Manager |
| `RADIOLOGIST` | Radiologist |
| `BILLING` | Billing Staff |
| `HR` | HR Manager |
| `DIETITIAN` | Dietitian |
| `PHYSIO` | Physiotherapist |
| `ANESTHETIST` | Anaesthetist |
| `SOCIAL_WORKER` | Social Worker |
| `IT_ADMIN` | IT Administrator |
| `SECURITY_OFC` | Security Officer |
| `ORDERLY` | Orderly |
| `PATIENT` | Patient |

> `*` in the authorize column means any authenticated user regardless of role.

---

## `/api/auth` — Authentication (10 routes)

| # | Method | Route | Rate Limit | Roles | Logic |
|---|--------|-------|------------|-------|-------|
| 1 | `POST` | `/login` | 20/15min per IP | Public | Validates credentials against Argon2id hash. Tracks failed attempts in Redis — locks account after 5 fails for 15 min and sends lockout email. Issues RS256 JWT access token (15 min TTL) + opaque refresh token (7 days, stored in Redis) |
| 2 | `POST` | `/refresh` | 20/15min per IP | Public | Validates opaque refresh token from Redis. Single-use — rotates token on every call. Issues new access token |
| 3 | `POST` | `/logout` | 20/15min per IP | Public | Deletes refresh token from Redis, marks session as revoked in DB |
| 4 | `POST` | `/otp/request` | 10/15min per IP | Public | Generates 6-digit OTP, stores in Redis with 10 min TTL, sends to encrypted email. Always returns same message to prevent username enumeration |
| 5 | `POST` | `/change-password` | 10/15min per IP | Public | Verifies OTP from Redis, hashes new password with Argon2id (65536 mem, 3 time, 4 parallel), clears OTP |
| 6 | `GET` | `/me` | 200/min | Any auth | Returns full profile — decrypts email/phone via pgcrypto, joins department name, roles array, patient MRN if applicable |
| 7 | `GET` | `/sessions` | 200/min | Any auth | Lists all active sessions for the current user with masked IP and device type |
| 8 | `DELETE` | `/sessions/:id` | 200/min | Any auth | Revokes a specific session (logout from one device) |
| 9 | `DELETE` | `/sessions` | 200/min | Any auth | Revokes all sessions except the current one (logout everywhere else) |
| 10 | `PATCH` | `/image` | 200/min | Any auth | Links an uploaded profile image file ID to the user record after verifying file ownership |

---

## `/api/admin` — Admin & User Management (15 routes)

| # | Method | Route | Roles | Logic |
|---|--------|-------|-------|-------|
| 1 | `GET` | `/stats` | ADMIN, SUPER_ADMIN, HR | Dashboard counts: total users, patients, appointments today, active sessions |
| 2 | `GET` | `/audit-logs` | ADMIN, SUPER_ADMIN, IT_ADMIN, INVENTORY | Paginated audit log with filters: user, action, entity, date range |
| 3 | `GET` | `/audit-logs/verify` | ADMIN, SUPER_ADMIN, IT_ADMIN | Walks entire audit chain, recomputes SHA-256 hashes, returns any broken links (tamper detection) |
| 4 | `PATCH` | `/audit-logs/:id/flag` | ADMIN, SUPER_ADMIN, IT_ADMIN | Flags a suspicious audit entry for review |
| 5 | `PATCH` | `/audit-logs/:id/unflag` | ADMIN, SUPER_ADMIN, IT_ADMIN | Removes flag from audit entry |
| 6 | `GET` | `/blocked-ips` | ADMIN, SUPER_ADMIN, IT_ADMIN | Lists all blocked IP addresses |
| 7 | `POST` | `/blocked-ips` | ADMIN, SUPER_ADMIN, IT_ADMIN | Blocks an IP — all subsequent requests from it get `403` before any route logic runs |
| 8 | `DELETE` | `/blocked-ips/:id` | ADMIN, SUPER_ADMIN, IT_ADMIN | Unblocks an IP address |
| 9 | `GET` | `/users` | ADMIN, SUPER_ADMIN, HR | Paginated user list with search, role filter, department filter |
| 10 | `POST` | `/users` | ADMIN, SUPER_ADMIN, HR | Creates staff account, assigns roles, sends welcome email with temporary password |
| 11 | `PATCH` | `/users/:id` | ADMIN, SUPER_ADMIN, HR | Updates user profile, department, roles |
| 12 | `PATCH` | `/users/:id/status` | ADMIN, SUPER_ADMIN, HR | Activates or deactivates a user account |
| 13 | `DELETE` | `/users/:id` | ADMIN, SUPER_ADMIN, HR | Soft-deletes user (sets `deleted_at`) — preserves audit trail |
| 14 | `GET` | `/sessions` | ADMIN, SUPER_ADMIN, IT_ADMIN | Lists all active sessions across all users |
| 15 | `DELETE` | `/sessions/:id` | ADMIN, SUPER_ADMIN, IT_ADMIN | Force-terminates any user session (security incident response) |

---

## `/api/patients` — Patient Records (8 routes)

| # | Method | Route | Roles | Logic |
|---|--------|-------|-------|-------|
| 1 | `GET` | `/my` | PATIENT | Returns the patient record linked to the logged-in user account |
| 2 | `GET` | `/lookup?mrn=` | SECURITY_OFC, RECEPTIONIST, ADMIN, SUPER_ADMIN | Quick MRN lookup for visitor check-in or security verification |
| 3 | `POST` | `/` | RECEPTIONIST | Registers new patient, generates unique MRN, encrypts PII (email, phone, address, emergency contact) with pgcrypto AES-256 |
| 4 | `GET` | `/` | RECEPTIONIST, NURSE, DOCTOR, ADMIN, SUPER_ADMIN, PHARMACIST, SOCIAL_WORKER, DIETITIAN, BILLING | Paginated patient list with search by name or MRN |
| 5 | `GET` | `/:id` | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT | Gets patient record. `checkOwnership` ensures PATIENT role can only access their own record |
| 6 | `PATCH` | `/:id` | RECEPTIONIST | Updates patient demographics |
| 7 | `GET` | `/:id/timeline` | DOCTOR, PATIENT | Full chronological medical history — appointments, vitals, prescriptions, lab results, discharge summaries. `checkOwnership` enforced |
| 8 | `GET` | `/medical-records/:id` | DOCTOR, PATIENT, ADMIN, SUPER_ADMIN | Gets a single medical record with `checkOwnership` |

---

## `/api/appointments` — Scheduling (5 routes)

| # | Method | Route | Roles | Logic |
|---|--------|-------|-------|-------|
| 1 | `GET` | `/` | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT, PHYSIO | Lists appointments filtered by role — doctors see their own, patients see their own, admins see all |
| 2 | `GET` | `/:id` | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT, PHYSIO | Gets single appointment details |
| 3 | `POST` | `/` | RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT | Books appointment, checks doctor availability, sends confirmation email via BullMQ, pushes real-time notification to doctor via Socket.io |
| 4 | `PATCH` | `/:id` | DOCTOR, RECEPTIONIST, ADMIN, SUPER_ADMIN | Updates status: CONFIRMED, CANCELLED, NO_SHOW, COMPLETED |
| 5 | `PATCH` | `/:id/patient` | PATIENT | Patient can only reschedule or cancel their own appointment (limited fields) |

---

## RBAC - 19 Roles

| Code | Role |
|------|------|
| SUPER_ADMIN | Super Administrator |
| ADMIN | Administrator |
| DOCTOR | Doctor |
| NURSE | Nurse |
| RECEPTIONIST | Receptionist |
| LAB_TECH | Lab Technician |
| PHARMACIST | Pharmacist |
| INVENTORY | Inventory Manager |
| RADIOLOGIST | Radiologist |
| BILLING | Billing Staff |
| HR | HR Manager |
| DIETITIAN | Dietitian |
| PHYSIO | Physiotherapist |
| ANESTHETIST | Anaesthetist |
| SOCIAL_WORKER | Social Worker |
| IT_ADMIN | IT Administrator |
| SECURITY_OFC | Security Officer |
| ORDERLY | Orderly |
| PATIENT | Patient |

> * in the authorize column means any authenticated user regardless of role.

---

## /api/auth - Authentication (10 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | /login | Public | Validates credentials against Argon2id hash. Tracks failed attempts in Redis, locks after 5 fails for 15 min, sends lockout email. Issues RS256 JWT (15 min) + opaque refresh token (7 days in Redis) |
| POST | /refresh | Public | Validates opaque refresh token from Redis. Single-use, rotates on every call. Issues new access token |
| POST | /logout | Public | Deletes refresh token from Redis, marks session revoked in DB |
| POST | /otp/request | Public | Generates 6-digit OTP, stores in Redis (10 min TTL), sends to encrypted email. Always returns same message to prevent username enumeration |
| POST | /change-password | Public | Verifies OTP from Redis, hashes new password with Argon2id, clears OTP |
| GET | /me | Any auth | Returns full profile - decrypts email/phone via pgcrypto, joins department, roles, patient MRN |
| GET | /sessions | Any auth | Lists all active sessions for current user with masked IP and device type |
| DELETE | /sessions/:id | Any auth | Revokes a specific session (logout from one device) |
| DELETE | /sessions | Any auth | Revokes all sessions except current (logout everywhere else) |
| PATCH | /image | Any auth | Links uploaded profile image file ID to user record |

---

## /api/admin - Admin and User Management (15 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /stats | ADMIN, SUPER_ADMIN, HR | Dashboard counts: total users, patients, appointments today, active sessions |
| GET | /audit-logs | ADMIN, SUPER_ADMIN, IT_ADMIN, INVENTORY | Paginated audit log with filters: user, action, entity, date range |
| GET | /audit-logs/verify | ADMIN, SUPER_ADMIN, IT_ADMIN | Walks entire audit chain, recomputes SHA-256 hashes, returns broken links (tamper detection) |
| PATCH | /audit-logs/:id/flag | ADMIN, SUPER_ADMIN, IT_ADMIN | Flags a suspicious audit entry for review |
| PATCH | /audit-logs/:id/unflag | ADMIN, SUPER_ADMIN, IT_ADMIN | Removes flag from audit entry |
| GET | /blocked-ips | ADMIN, SUPER_ADMIN, IT_ADMIN | Lists all blocked IP addresses |
| POST | /blocked-ips | ADMIN, SUPER_ADMIN, IT_ADMIN | Blocks an IP - all requests from it get 403 before any route logic |
| DELETE | /blocked-ips/:id | ADMIN, SUPER_ADMIN, IT_ADMIN | Unblocks an IP address |
| GET | /users | ADMIN, SUPER_ADMIN, HR | Paginated user list with search, role filter, department filter |
| POST | /users | ADMIN, SUPER_ADMIN, HR | Creates staff account, assigns roles, sends welcome email with temp password |
| PATCH | /users/:id | ADMIN, SUPER_ADMIN, HR | Updates user profile, department, roles |
| PATCH | /users/:id/status | ADMIN, SUPER_ADMIN, HR | Activates or deactivates a user account |
| DELETE | /users/:id | ADMIN, SUPER_ADMIN, HR | Soft-deletes user (sets deleted_at) - preserves audit trail |
| GET | /sessions | ADMIN, SUPER_ADMIN, IT_ADMIN | Lists all active sessions across all users |
| DELETE | /sessions/:id | ADMIN, SUPER_ADMIN, IT_ADMIN | Force-terminates any user session (security incident response) |

---

## /api/patients - Patient Records (8 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /my | PATIENT | Returns the patient record linked to the logged-in user |
| GET | /lookup?mrn= | SECURITY_OFC, RECEPTIONIST, ADMIN, SUPER_ADMIN | Quick MRN lookup for visitor check-in or security |
| POST | / | RECEPTIONIST | Registers new patient, generates unique MRN, encrypts PII with pgcrypto AES-256 |
| GET | / | RECEPTIONIST, NURSE, DOCTOR, ADMIN, SUPER_ADMIN, PHARMACIST, SOCIAL_WORKER, DIETITIAN, BILLING | Paginated patient list with search |
| GET | /:id | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT | Gets patient record. checkOwnership ensures PATIENT can only access their own |
| PATCH | /:id | RECEPTIONIST | Updates patient demographics |
| GET | /:id/timeline | DOCTOR, PATIENT | Full chronological history - appointments, vitals, prescriptions, lab results, discharge summaries |
| GET | /medical-records/:id | DOCTOR, PATIENT, ADMIN, SUPER_ADMIN | Gets a single medical record with checkOwnership |

---

## /api/appointments - Scheduling (5 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT, PHYSIO | Lists appointments filtered by role |
| GET | /:id | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT, PHYSIO | Gets single appointment details |
| POST | / | RECEPTIONIST, ADMIN, SUPER_ADMIN, PATIENT | Books appointment, checks availability, sends confirmation email via BullMQ, notifies doctor via Socket.io |
| PATCH | /:id | DOCTOR, RECEPTIONIST, ADMIN, SUPER_ADMIN | Updates status: CONFIRMED, CANCELLED, NO_SHOW, COMPLETED |
| PATCH | /:id/patient | PATIENT | Patient can only reschedule or cancel their own appointment |

---

## /api/prescriptions - Prescriptions and Medicines (12 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /medicines/search?q= | DOCTOR, PHARMACIST, NURSE, ADMIN, SUPER_ADMIN | Searches local medicine DB + OpenFDA API, returns brand name, generic, form, strength, controlled flag |
| GET | /medicines | DOCTOR, PHARMACIST, NURSE, ADMIN, SUPER_ADMIN | Paginated full medicine list |
| POST | /medicines | DOCTOR, PHARMACIST, ADMIN, SUPER_ADMIN | Adds new medicine to DB (upsert by name) |
| POST | /medicines/import-openfda | ADMIN, SUPER_ADMIN | Bulk imports medicines from OpenFDA API |
| POST | / | DOCTOR | Creates prescription with symptoms, ICD-10 codes, medicine items, optional nurse assignment. Checks drug interactions and allergy conflicts. Notifies patient and pharmacist |
| GET | /count | DOCTOR, PHARMACIST, ADMIN, SUPER_ADMIN | Returns prescription count for dashboard badges |
| GET | / | PHARMACIST, ADMIN, SUPER_ADMIN | Pharmacist queue - lists pending prescriptions to dispense |
| GET | /patient/:patientId | DOCTOR, PHARMACIST, ADMIN, SUPER_ADMIN | Full prescription history for a patient |
| GET | /my | PATIENT | Patient's own prescriptions |
| GET | /:id | DOCTOR, PHARMACIST, PATIENT, ADMIN, SUPER_ADMIN | Single prescription with checkOwnership |
| PATCH | /:id/dispense | PHARMACIST | Marks items as dispensed, updates stock, notifies patient |
| GET | /:id/pdf | DOCTOR, PHARMACIST, PATIENT, ADMIN, SUPER_ADMIN | Generates PDF via Puppeteer, streams to client |

---

## /api/vitals - Patient Vitals (3 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | / | NURSE, DOCTOR, ADMIN, SUPER_ADMIN | Records vitals (BP, temp, pulse, SpO2, weight, glucose, resp. rate). Server-side threshold checks - critical values trigger push notifications to assigned doctor |
| GET | /count | NURSE, ADMIN, SUPER_ADMIN | Count of vitals recorded (dashboard stat) |
| GET | /patient/:patientId | DOCTOR, NURSE, PATIENT, ADMIN, SUPER_ADMIN | Vitals history with ?days=7&limit=50 - used to render 7-day trend charts |

---

## /api/lab-orders - Lab Tests (6 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | LAB_TECH, DOCTOR, NURSE, ADMIN, SUPER_ADMIN, RADIOLOGIST | Lists lab orders with status filter: PENDING, IN_PROGRESS, COMPLETED |
| POST | / | DOCTOR, ADMIN, SUPER_ADMIN | Creates lab order linked to medical record, notifies lab tech |
| PATCH | /:id | LAB_TECH, ADMIN, SUPER_ADMIN, RADIOLOGIST | Updates order status: collect sample, process, complete |
| GET | /results/:id | LAB_TECH, DOCTOR, PATIENT, ADMIN, SUPER_ADMIN | Gets single lab result with checkOwnership |
| POST | /results | LAB_TECH, ADMIN, SUPER_ADMIN | Enters lab result with values, reference ranges, abnormality flags. Notifies doctor and patient |
| GET | /patient/:patientId/results | DOCTOR, ADMIN, SUPER_ADMIN, PATIENT | All lab results for a patient |

---

## /api/billing - Bills and Payments (16 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /pending-services/:patientId | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Lists unbilled services for bill generation |
| POST | / | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Creates itemized bill with services, taxes, discounts |
| GET | /patient/:patientId | Any auth | Gets all bills for a patient |
| GET | /:id | Any auth | Gets single bill with checkOwnership |
| PATCH | /:id/pay | Any auth | Records cash or check payment |
| POST | /:id/create-order | PATIENT, ADMIN, SUPER_ADMIN, RECEPTIONIST, BILLING | Creates Razorpay order for online payment |
| POST | /:id/verify-payment | PATIENT, ADMIN, SUPER_ADMIN, RECEPTIONIST, BILLING | Verifies Razorpay HMAC-SHA256 signature, marks bill as paid |
| POST | /:id/refund | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Processes refund with reason |
| PATCH | /:id/insurance-claim | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Attaches insurance claim to bill |
| PATCH | /:id/discount-approval | ADMIN, SUPER_ADMIN | Approves or rejects a discount request |
| GET | /:id/pdf | BILLING, PATIENT, ADMIN, SUPER_ADMIN, RECEPTIONIST | Generates bill PDF via Puppeteer |
| POST | /insurance | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Creates insurance policy for a patient |
| GET | /insurance/patient/:patientId | Any auth | Gets patient insurance policies |
| PATCH | /insurance/:id | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Updates insurance policy |
| DELETE | /insurance/:id | RECEPTIONIST, BILLING, ADMIN, SUPER_ADMIN | Removes insurance policy |
| GET | /summary/financial | ADMIN, SUPER_ADMIN | Revenue summary, payment breakdown, outstanding balances |

---

## /api/inventory - Stock, Beds and QR Codes (15 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /stats | INVENTORY, ADMIN, SUPER_ADMIN, DOCTOR, NURSE | Total items, low-stock count, bed occupancy rate |
| GET | /alerts | INVENTORY, ADMIN, SUPER_ADMIN | Items below reorder threshold |
| GET | /beds | INVENTORY, ADMIN, SUPER_ADMIN, NURSE, DOCTOR, RECEPTIONIST, ORDERLY | Full bed matrix with room, status, patient name if occupied |
| POST | /beds/rooms | INVENTORY, ADMIN, SUPER_ADMIN | Creates a new room |
| POST | /beds/rooms/:roomId/beds | INVENTORY, ADMIN, SUPER_ADMIN | Adds beds to a room |
| PATCH | /beds/:id | INVENTORY, ADMIN, SUPER_ADMIN, NURSE | Updates bed status or assigns/unassigns a patient |
| POST | /qr/generate | INVENTORY, ADMIN, SUPER_ADMIN | Generates QR code for an inventory item, stores code in DB |
| GET | /qr/:code | INVENTORY, ADMIN, SUPER_ADMIN, NURSE, DOCTOR | Looks up item by QR code scan |
| POST | /import | INVENTORY, ADMIN, SUPER_ADMIN | Bulk imports items from CSV (multer, 5MB limit, CSV only) |
| GET | / | INVENTORY, ADMIN, SUPER_ADMIN, DOCTOR, NURSE, PHARMACIST | Paginated item list with search and category filter |
| POST | / | INVENTORY, ADMIN, SUPER_ADMIN | Creates inventory item |
| GET | /:id | INVENTORY, ADMIN, SUPER_ADMIN, DOCTOR, NURSE, PHARMACIST | Gets single item |
| PATCH | /:id | INVENTORY, ADMIN, SUPER_ADMIN | Updates item details |
| DELETE | /:id | INVENTORY, ADMIN, SUPER_ADMIN | Soft-deletes item |
| PATCH | /:id/adjust | INVENTORY, ADMIN, SUPER_ADMIN, NURSE | Adjusts stock quantity with reason |

---

## /api/analytics - Reports and Dashboards (8 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /patient-stats | ADMIN, SUPER_ADMIN, DOCTOR, HR | Patient volume, admission/discharge trends, demographics |
| GET | /financial | ADMIN, SUPER_ADMIN, BILLING | Revenue by period, payment method breakdown, outstanding amounts |
| GET | /staff-performance | ADMIN, SUPER_ADMIN, HR | Appointments per doctor, leave utilization, shift coverage |
| GET | /operational | ADMIN, SUPER_ADMIN, DOCTOR, HR | Bed occupancy, avg length of stay, OT utilization |
| GET | /reports/generate | ADMIN, SUPER_ADMIN | Enqueues BullMQ report generation job (PDF/CSV). Tighter limit: 10 per 10 min per user |
| GET | /reports/history | ADMIN, SUPER_ADMIN | Lists previously generated reports |
| GET | /reports/status/:jobId | ADMIN, SUPER_ADMIN | Polls BullMQ job status: queued, active, completed |
| GET | /reports/download/:key | ADMIN, SUPER_ADMIN | Downloads generated report file |

---

## /api/telemedicine - Video Consultations (4 HTTP + 4 Socket.io events)

### HTTP Routes

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | /sessions | DOCTOR, RECEPTIONIST, ADMIN, SUPER_ADMIN | Creates telemedicine session linked to appointment, generates unique room_token |
| GET | /sessions/my | Any auth | Lists the user's telemedicine sessions (upcoming and past) |
| GET | /sessions/:id/token | Any auth | Returns room token - validated that requester is the doctor or patient for that appointment. Only valid within appointment time + 30 min grace period |
| PATCH | /sessions/:id/end | DOCTOR, ADMIN, SUPER_ADMIN | Ends session, saves consultation note, marks appointment COMPLETED |

### Socket.io Namespace: /telemedicine

| Event | Direction | Logic |
|-------|-----------|-------|
| tele:join | Client to Server | Validates participant against DB, joins Socket.io room, notifies existing peers |
| tele:signal | Client to Server | Relays WebRTC offer/answer/ICE candidates to target peer - server never inspects content |
| tele:chat | Client to Server | Relays AES-256-GCM ciphertext only - server never decrypts or logs content |
| tele:leave | Client to Server | Notifies room of departure, cleans up socket room membership |

---

## /api/messaging - Encrypted Group Chat (12 HTTP + 8 Socket.io events)

### HTTP Routes

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /users | Any auth | Lists all non-patient staff for DM picker and group creation |
| GET | /groups | Any auth | Lists all groups the current user is a member of |
| POST | /groups | ADMIN, SUPER_ADMIN, DOCTOR, NURSE, RECEPTIONIST, LAB_TECH, PHARMACIST, HR, IT_ADMIN | Creates new group with initial members |
| GET | /groups/:groupId/key | Any auth (member only) | Returns shared AES encryption key - only if requester is a member |
| GET | /groups/:groupId/members | Any auth | Lists group members |
| POST | /groups/:groupId/members | Any auth (member only) | Adds new member - requester must already be a member |
| GET | /groups/:groupId/history | Any auth (member only) | Paginated message history - returns ciphertext, client decrypts locally |
| GET | /groups/:groupId/pinned | Any auth | Returns pinned messages for a group |
| GET | /direct/:userId/history | Any auth | Paginated DM history between two users |
| DELETE | /:id | Any auth | Deletes message - only sender can delete. Within time window: deletes for everyone |
| PATCH | /:id/react | Any auth | Adds or removes emoji reaction (thumbs up, heart, laugh, wow only) |
| POST | /:id/read | Any auth | Marks a message as read |

### Socket.io Namespace: /messaging

| Event | Direction | Logic |
|-------|-----------|-------|
| message:send | Client to Server | Saves ciphertext to DB, publishes via Redis pub/sub to all server instances |
| message:delivered | Client to Server | Delivery receipt broadcast |
| message:read | Client to Server | Read receipt broadcast |
| typing:start | Client to Server | Broadcasts typing indicator, auto-clears after 3 seconds |
| typing:stop | Client to Server | Clears typing indicator immediately |
| message:react | Client to Server | Adds emoji reaction, broadcasts to group |
| message:unreact | Client to Server | Removes emoji reaction, broadcasts to group |
| message:delete | Client to Server | Delete-for-everyone broadcast to group |

---

## /api/notifications - In-App and Push Notifications (8 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | Any auth | Paginated notification list with optional type filter |
| GET | /unread-count | Any auth | Returns unread count for the bell badge |
| PATCH | /:id/read | Any auth | Marks a single notification as read |
| PATCH | /read-all | Any auth | Marks all notifications as read |
| DELETE | /:id | Any auth | Deletes a notification |
| GET | /vapid-public-key | Any auth | Returns VAPID public key - browser needs this to create a Web Push subscription |
| POST | /subscribe | Any auth | Saves Web Push subscription (endpoint + p256dh + auth keys) to DB |
| DELETE | /subscribe | Any auth | Removes push subscription on logout |

### Socket.io Namespace: /notifications

| Event | Direction | Logic |
|-------|-----------|-------|
| notification:new | Server to Client | Pushes real-time notification to user's personal room (user:<id>) |

---

## /api/blood-bank - Blood Inventory (7 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /availability | Any auth | Returns available units grouped by blood group |
| POST | /request | DOCTOR | Requests blood units for a patient - checks availability, reserves units |
| GET | / | ADMIN, SUPER_ADMIN, LAB_TECH, DOCTOR, NURSE, INVENTORY | Full blood unit list with expiry dates |
| POST | / | ADMIN, SUPER_ADMIN, LAB_TECH | Adds blood units with donor info, blood group, expiry |
| GET | /:id | ADMIN, SUPER_ADMIN, LAB_TECH, DOCTOR, NURSE, INVENTORY | Single unit details |
| PATCH | /:id | ADMIN, SUPER_ADMIN, LAB_TECH | Updates unit status: AVAILABLE, RESERVED, USED, EXPIRED |
| DELETE | /:id | ADMIN, SUPER_ADMIN | Removes a blood unit |

---

## /api/broadcast - System Announcements (5 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | /staff-count | ADMIN, SUPER_ADMIN | Returns count of staff who will receive a broadcast (for confirmation modal) |
| POST | / | ADMIN, SUPER_ADMIN | Creates broadcast targeted at specific roles, enqueues notifications via BullMQ |
| GET | / | ADMIN, SUPER_ADMIN | Lists all broadcasts with delivery stats |
| GET | /:id | ADMIN, SUPER_ADMIN | Single broadcast details |
| GET | /:id/read-receipts | ADMIN, SUPER_ADMIN | Who has read the broadcast and when |

---

## /api/discharge - Discharge Summaries (2 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | / | DOCTOR | Creates discharge summary linked to medical record - includes diagnosis, treatment, follow-up instructions, discharge medications. Frees the patient's bed automatically |
| GET | /:patientId | DOCTOR, NURSE, PATIENT, ADMIN, SUPER_ADMIN | Lists all discharge summaries for a patient |

---

## /api/ot-scheduling - Operating Theatre (5 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, ANESTHETIST | Lists OT schedules with date range filter - used to render the OT calendar |
| POST | / | DOCTOR | Books OT slot - links patient, surgeon, anesthetist, OT room, procedure name, scheduled time |
| GET | /:id | DOCTOR, NURSE, RECEPTIONIST, ADMIN, SUPER_ADMIN, ANESTHETIST | Single OT schedule details |
| PATCH | /:id | DOCTOR, ADMIN, SUPER_ADMIN | Updates OT schedule: reschedule or change status SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED |
| DELETE | /:id | DOCTOR, ADMIN, SUPER_ADMIN | Cancels and removes an OT booking |

---

## /api/handover-notes - Nurse Shift Handovers (3 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | NURSE, ADMIN, SUPER_ADMIN | Lists handover notes for the ward - filters by ward/date, shows read/unread status |
| POST | / | NURSE, ADMIN, SUPER_ADMIN | Creates handover note with patient list, observations, pending tasks, priority flags for incoming shift |
| PATCH | /:id/read | NURSE, ADMIN, SUPER_ADMIN | Marks a handover note as read by the incoming nurse |

---

## /api/nurse-assignments - Ward Assignments (1 route)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | NURSE, ADMIN, SUPER_ADMIN | Returns the nurse's current patient assignments - which beds/patients they are responsible for today |

---

## /api/leaves - Leave Management (7 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | / | All staff except PATIENT | Submits leave request with type (ANNUAL, SICK, EMERGENCY), dates, reason. Checks leave balance |
| GET | /my | Any auth | Returns current user's own leave history and status |
| GET | /calendar | Any auth | Returns approved leaves as calendar events - shows who is off on which day |
| GET | / | ADMIN, SUPER_ADMIN, HR | All leave requests across all staff with status filter |
| GET | /balances/:userId | Any auth | Returns leave balance breakdown: annual used/remaining, sick used/remaining |
| PATCH | /:id/approve | ADMIN, SUPER_ADMIN, HR | Approves leave request, deducts from balance, notifies staff member |
| PATCH | /:id/reject | ADMIN, SUPER_ADMIN, HR | Rejects with reason, notifies staff member |

---

## /api/shifts - Shift Scheduling (3 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | ADMIN, SUPER_ADMIN, HR | Lists shift schedules with date and department filters |
| POST | / | ADMIN, SUPER_ADMIN, HR | Creates shift assignment - links user to shift type (MORNING/AFTERNOON/NIGHT) and date. Checks for conflicts |
| DELETE | /:id | ADMIN, SUPER_ADMIN, HR | Removes a shift assignment |

---

## /api/departments - Department Management (3 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | All 19 roles | Every authenticated user can list departments - used in dropdowns across the app |
| POST | / | ADMIN, SUPER_ADMIN | Creates new department with name, code, floor, optional head of department |
| PATCH | /:id | ADMIN, SUPER_ADMIN | Updates department details or reassigns the head |

---

## /api/doctors - Doctor Directory (1 route)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | Any auth | Lists all active doctors with department and specialization - used in appointment booking dropdowns |

---

## /api/files - Encrypted File Storage (8 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | /profile-image/:userId | Any auth (own) or ADMIN | Uploads profile image (5MB limit). Only the user themselves or admin can upload. Validates mime type |
| GET | /profile-image/:fileId | Any auth | Downloads profile image. Returns X-Encryption-IV header so client can decrypt |
| PATCH | /profile-image/:fileId/iv | Any auth | Updates encryption IV after client-side encryption (two-step upload) |
| POST | /upload | NURSE, LAB_TECH, DOCTOR, ADMIN, SUPER_ADMIN | Uploads clinical file (20MB limit). AES-256-GCM encrypted client-side before upload. ClamAV virus scan runs server-side. Mime-type validated |
| PATCH | /:id/iv | NURSE, LAB_TECH, DOCTOR, ADMIN, SUPER_ADMIN | Sends encryption IV after upload (separate request to avoid race condition) |
| PATCH | /:id/entity | NURSE, LAB_TECH, DOCTOR, ADMIN, SUPER_ADMIN | Re-links file to its entity (e.g. lab result uploaded before result record existed) |
| GET | /:id/download | DOCTOR, NURSE, LAB_TECH, PATIENT, ADMIN, SUPER_ADMIN | Downloads file - returns encrypted bytes + IV header. Client decrypts locally |
| DELETE | /:id | ADMIN, SUPER_ADMIN | Soft-deletes a file record |

---

## /api/case-notes - Social Worker Notes (3 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | SOCIAL_WORKER, DOCTOR, ADMIN, SUPER_ADMIN | Lists case notes for a patient - psychosocial assessments, family situation, support plans |
| POST | / | SOCIAL_WORKER, ADMIN, SUPER_ADMIN | Creates case note linked to a patient |
| PATCH | /:id | SOCIAL_WORKER, ADMIN, SUPER_ADMIN | Updates a case note |

---

## /api/diet-plans - Dietitian Plans (3 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| GET | / | DIETITIAN, DOCTOR, NURSE, ADMIN, SUPER_ADMIN | Lists diet plans for a patient |
| POST | / | DIETITIAN, ADMIN, SUPER_ADMIN | Creates diet plan with meal schedule, caloric targets, restrictions |
| PATCH | /:id | DIETITIAN, ADMIN, SUPER_ADMIN | Updates a diet plan |

---

## /api/incidents - Incident Reporting (2 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | / | Any auth (*) | Any staff member can report a safety incident: near-miss, patient fall, medication error, equipment failure |
| GET | / | ADMIN, SUPER_ADMIN, HR, SECURITY_OFC | Lists all incidents with severity and status filters |

---

## /api/visitors - Visitor Logging (5 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | / | RECEPTIONIST, SECURITY_OFC, ADMIN, SUPER_ADMIN | Logs visitor check-in: name, ID, patient being visited, purpose, timestamp |
| GET | / | RECEPTIONIST, SECURITY_OFC, ADMIN, SUPER_ADMIN | Lists all current and past visitors with check-in/out times |
| GET | /patient/:patientId | RECEPTIONIST, SECURITY_OFC, ADMIN, SUPER_ADMIN | Visitor history for a specific patient |
| PATCH | /:id/checkout | RECEPTIONIST, SECURITY_OFC, ADMIN, SUPER_ADMIN | Records visitor check-out time |
| GET | /search | RECEPTIONIST, SECURITY_OFC, ADMIN, SUPER_ADMIN | Searches visitors by name or ID number |

---

## /api/chatbot - AI Patient Assistant (2 routes)

| Method | Route | Roles | Logic |
|--------|-------|-------|-------|
| POST | /message | PATIENT only | Sends message to AI (Gemini/OpenAI/Ollama). Rate limited: 30/min per IP + 20/hour per user in Redis. Passes patient context to AI |
| GET | /history | PATIENT only | Returns patient's chat history from DB |

---

## Route Count by Module

| Module | Routes |
|--------|--------|
| billing | 16 |
| admin | 15 |
| inventory | 15 |
| prescription | 12 |
| messaging | 12 |
| auth | 10 |
| notifications | 8 |
| analytics | 8 |
| files | 8 |
| patient | 8 |
| blood-bank | 7 |
| leaves | 7 |
| lab-orders | 6 |
| appointments | 5 |
| broadcast | 5 |
| ot-scheduling | 5 |
| visitors | 5 |
| telemedicine | 4 |
| shifts | 3 |
| departments | 3 |
| handover-notes | 3 |
| case-notes | 3 |
| diet-plans | 3 |
| vitals | 3 |
| discharge | 2 |
| incidents | 2 |
| chatbot | 2 |
| doctors | 1 |
| nurse-assignments | 1 |
| **TOTAL HTTP** | **183** |
| **Socket.io events** | **12** |
| **GRAND TOTAL** | **195** |

---

## Middleware Pipeline

Every route passes through this chain in order:

`
Request
  -> IP Block Check       (403 if blocked)
  -> Rate Limiter         (Redis sliding window, 429 if exceeded)
  -> authenticate         (RS256 JWT verification, 401 if invalid/expired)
  -> authorize            (RBAC role check, 403 if unauthorized)
  -> validate             (Zod schema, 422 if invalid input)
  -> checkOwnership       (where applicable, 403 if not owner)
  -> Controller           (business logic, DB queries)
  -> auditMiddleware      (async SHA-256 chained log after response)
`

## Security Highlights

| Feature | Implementation |
|---------|---------------|
| Authentication | RS256 JWT, 15 min access token, 7 day rotating refresh token |
| Password Hashing | Argon2id (65536 memory, 3 time cost, 4 parallelism) |
| Database Encryption | pgcrypto AES-256 for PII fields (email, phone, address) |
| File Encryption | AES-256-GCM client-side before upload |
| Transport | HTTPS + WSS |
| CSRF | Double-submit cookie pattern |
| Rate Limiting | Redis sliding window per IP/user |
| Account Lockout | 5 failed logins = 15 min lockout + email alert |
| Audit Trail | SHA-256 chained tamper-evident log on every request |
| Input Validation | Zod schemas on both frontend and backend |
| Virus Scanning | ClamAV on all file uploads |
