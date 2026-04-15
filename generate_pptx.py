from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
import copy

# ── Colors ──────────────────────────────────────────────────────────────────
NAVY       = RGBColor(0x0D, 0x21, 0x37)
TEAL       = RGBColor(0x00, 0xB4, 0xD8)
DARK_TEAL  = RGBColor(0x00, 0x96, 0xB7)
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_BLUE = RGBColor(0xE8, 0xF4, 0xF8)
SLATE_GRAY = RGBColor(0x64, 0x74, 0x8B)
DARK       = RGBColor(0x1E, 0x29, 0x3B)
GREEN      = RGBColor(0x22, 0xC5, 0x5E)
RED        = RGBColor(0xEF, 0x44, 0x44)
YELLOW     = RGBColor(0xF5, 0x9E, 0x0B)

# ── Presentation setup ───────────────────────────────────────────────────────
prs = Presentation()
prs.slide_width  = Inches(13.33)
prs.slide_height = Inches(7.5)

BLANK_LAYOUT = prs.slide_layouts[6]   # completely blank

# ── Helper functions ─────────────────────────────────────────────────────────

def add_filled_rect(slide, x, y, w, h, fill_color, line_color=None):
    shape = slide.shapes.add_shape(
        1,  # MSO_SHAPE_TYPE.RECTANGLE
        Inches(x), Inches(y), Inches(w), Inches(h)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    if line_color:
        shape.line.color.rgb = line_color
    else:
        shape.line.fill.background()
    return shape


def add_textbox(slide, x, y, w, h, text, font_size, bold=False, italic=False,
                color=WHITE, align=PP_ALIGN.LEFT, word_wrap=True, font_name="Calibri"):
    txBox = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = txBox.text_frame
    tf.word_wrap = word_wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    run.font.name = font_name
    return txBox


def add_title_bar(slide, title_text, font_size=22):
    """Navy full-width title bar at top with white text."""
    bar = add_filled_rect(slide, 0, 0, 13.33, 0.7, NAVY)
    tb = slide.shapes.add_textbox(Inches(0.25), Inches(0.08), Inches(12.8), Inches(0.55))
    tf = tb.text_frame
    tf.word_wrap = False
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    run = p.add_run()
    run.text = title_text
    run.font.size = Pt(font_size)
    run.font.bold = True
    run.font.color.rgb = WHITE
    run.font.name = "Calibri"
    return bar


def add_accent_bar(slide):
    """Teal left accent bar below title bar."""
    add_filled_rect(slide, 0, 0.7, 0.15, 6.8, TEAL)


def add_navy_bg(slide):
    """Full navy background for title/closing slides."""
    add_filled_rect(slide, 0, 0, 13.33, 7.5, NAVY)


def add_bullet_textbox(slide, x, y, w, h, bullets, font_size=14, color=DARK):
    """Add a textbox with multiple bullet paragraphs."""
    txBox = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = txBox.text_frame
    tf.word_wrap = True
    first = True
    for bullet in bullets:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        p.space_before = Pt(4)
        run = p.add_run()
        run.text = bullet
        run.font.size = Pt(font_size)
        run.font.color.rgb = color
        run.font.name = "Calibri"
    return txBox


def add_notes(slide, text):
    notes_slide = slide.notes_slide
    tf = notes_slide.notes_text_frame
    tf.text = text


def add_badge_box(slide, x, y, w, h, text, font_size=11):
    """Rounded-ish badge: teal fill, white text."""
    shape = slide.shapes.add_shape(
        5,  # ROUNDED_RECTANGLE
        Inches(x), Inches(y), Inches(w), Inches(h)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = TEAL
    shape.line.fill.background()
    tf = shape.text_frame
    tf.word_wrap = False
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = text
    run.font.size = Pt(font_size)
    run.font.bold = True
    run.font.color.rgb = WHITE
    run.font.name = "Calibri"
    return shape


def add_hline(slide, x, y, w, color=TEAL, thickness=Pt(2)):
    """Horizontal line."""
    line = slide.shapes.add_shape(
        1,
        Inches(x), Inches(y), Inches(w), Inches(0.02)
    )
    line.fill.solid()
    line.fill.fore_color.rgb = color
    line.line.fill.background()
    return line


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 1 — TITLE
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 1: Title...")
slide1 = prs.slides.add_slide(BLANK_LAYOUT)
add_navy_bg(slide1)

# Main title
add_textbox(slide1, 0.5, 1.1, 12.33, 1.0,
            "Hospital Management System (HMS)",
            36, bold=True, color=WHITE, align=PP_ALIGN.CENTER)

# Subtitle
add_textbox(slide1, 0.5, 2.2, 12.33, 0.6,
            "A Full-Stack, Role-Based, Secure Healthcare Platform",
            18, italic=True, color=TEAL, align=PP_ALIGN.CENTER)

# Divider
add_hline(slide1, 1.0, 3.0, 11.33)

# Badge boxes
badges = ["19 User Roles", "30+ API Modules", "40+ DB Tables", "Real-Time + PWA"]
badge_w = 2.4
badge_gap = 0.3
start_x = (13.33 - (4 * badge_w + 3 * badge_gap)) / 2
for i, badge in enumerate(badges):
    bx = start_x + i * (badge_w + badge_gap)
    add_badge_box(slide1, bx, 3.2, badge_w, 0.45, badge, font_size=11)

# Bottom credit
add_textbox(slide1, 0.5, 6.4, 12.33, 0.4,
            "Presented by: [Your Name]  |  [Institution]  |  April 2026",
            12, color=WHITE, align=PP_ALIGN.CENTER)

add_notes(slide1, "Introduce yourself. This is a production-grade Hospital Management System covering every hospital department — clinical, admin, HR, billing, and security. It supports 19 user roles and is built as a Progressive Web App.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 2 — INTRODUCTION
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 2: Introduction...")
slide2 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide2, "Introduction")
add_accent_bar(slide2)

bullets2 = [
    "  \u2022  A web-based Hospital Management System (HMS) built for real hospital operations",
    "  \u2022  Supports 19 distinct user roles \u2014 doctors, nurses, patients, billing, HR, security, and more",
    "  \u2022  Manages the complete patient journey: Registration \u2192 Consultation \u2192 Treatment \u2192 Discharge \u2192 Billing",
    "  \u2022  Enables real-time communication between all hospital departments via live chat and notifications",
    "  \u2022  Built as a Progressive Web App (PWA) \u2014 installable on mobile, works offline",
    "  \u2022  Every action is logged in a tamper-evident audit trail",
]
add_bullet_textbox(slide2, 0.4, 0.85, 12.7, 6.0, bullets2, font_size=15, color=DARK)

add_notes(slide2, "This is not a simple CRUD application. It mirrors how a real hospital operates. Every department has its own dedicated module. The system supports 19 different user roles, each with their own dashboard and permissions. It's also a PWA — staff can install it on their phones and use it even without internet.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 3 — PROBLEM STATEMENT
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 3: Problem Statement...")
slide3 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide3, "The Problem We're Solving")
add_accent_bar(slide3)

bullets3 = [
    "  \u2022  Hospitals rely on paper records and manual processes \u2014 slow, error-prone, and insecure",
    "  \u2022  Patient data is scattered across departments with no unified view",
    "  \u2022  No real-time coordination between doctors, nurses, pharmacists, and labs",
    "  \u2022  Billing and inventory managed separately \u2014 causing delays and financial losses",
    "  \u2022  No audit trail \u2014 impossible to track who changed what and when",
    "  \u2022  Security gaps \u2014 unauthorized access to sensitive patient data is a real risk",
]
add_bullet_textbox(slide3, 0.4, 0.85, 12.7, 6.0, bullets3, font_size=15, color=DARK)

add_notes(slide3, "The core problem is fragmentation. A doctor writes a prescription on paper, a nurse records vitals in a notebook, billing is done on a separate spreadsheet. There's no single source of truth. This leads to medical errors, data loss, and security breaches. Our system solves this by bringing every department onto one unified, secure, real-time platform.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 4 — OBJECTIVES
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 4: Objectives...")
slide4 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide4, "Project Objectives")
add_accent_bar(slide4)

bullets4 = [
    "  \u2022  Digitize all hospital workflows \u2014 clinical, administrative, and operational",
    "  \u2022  Enforce role-based access so each user sees only what they're authorized to see",
    "  \u2022  Enable real-time collaboration between departments via live messaging and notifications",
    "  \u2022  Secure patient data with encryption, audit trails, and multi-layer authentication",
    "  \u2022  Automate billing, inventory alerts, shift scheduling, and leave management",
    "  \u2022  Provide analytics dashboards for data-driven hospital administration",
]
add_bullet_textbox(slide4, 0.4, 0.85, 12.7, 6.0, bullets4, font_size=15, color=DARK)

add_notes(slide4, "Our objectives were clear: digitize, secure, and connect. Every hospital role gets a purpose-built interface, every action is audited, and every piece of sensitive data is encrypted. The system also automates routine tasks like sending low-stock alerts or generating PDF discharge summaries.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 5 — SYSTEM OVERVIEW
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 5: System Overview...")
slide5 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide5, "System Overview")
add_accent_bar(slide5)

arch_diagram = (
    "  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n"
    "  \u2502         FRONTEND  (React 18 PWA)            \u2502\n"
    "  \u2502  19 Role Dashboards \u2502 Real-time UI Updates  \u2502\n"
    "  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n"
    "                 \u2502  HTTPS + WebSocket (WSS)\n"
    "  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25bc\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n"
    "  \u2502      BACKEND  (Node.js + Express 5)         \u2502\n"
    "  \u2502  30+ API Modules \u2502 JWT Auth \u2502 Socket.io     \u2502\n"
    "  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n"
    "         \u2502                       \u2502\n"
    "  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u25bc\u2500\u2500\u2500\u2500\u2500\u2510       \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25bc\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n"
    "  \u2502 PostgreSQL  \u2502       \u2502  Redis Cache    \u2502\n"
    "  \u2502 40+ Tables  \u2502       \u2502  Sessions       \u2502\n"
    "  \u2502 PII Encrypt \u2502       \u2502  Job Queues     \u2502\n"
    "  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518       \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518"
)

txBox5 = slide5.shapes.add_textbox(Inches(0.3), Inches(0.8), Inches(8.5), Inches(4.2))
tf5 = txBox5.text_frame
tf5.word_wrap = False
p5 = tf5.paragraphs[0]
run5 = p5.add_run()
run5.text = arch_diagram
run5.font.size = Pt(9)
run5.font.color.rgb = TEAL
run5.font.name = "Courier New"

bullets5 = [
    "  \u2022  Frontend: React 18 + Vite PWA with Zustand state management and TanStack Query",
    "  \u2022  Backend: Node.js + Express 5 with 30+ independent feature modules",
    "  \u2022  Data layer: PostgreSQL (40+ tables, field-level encryption) + Redis (sessions, queues)",
]
add_bullet_textbox(slide5, 0.3, 5.1, 12.7, 2.2, bullets5, font_size=14, color=DARK)

add_notes(slide5, "The system follows a three-tier architecture with additional layers. Redis handles sessions and rate limiting. Socket.io enables real-time features. The backend is organized into 30+ independent modules, each handling a specific hospital function.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 6 — ARCHITECTURE DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 6: Architecture Diagram...")
slide6 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide6, "Technical Architecture \u2014 Middleware Pipeline")
add_accent_bar(slide6)

middleware_diagram = (
    "  EVERY REQUEST PASSES THROUGH 9 LAYERS:\n\n"
    "  [1] Request ID  \u2192  [2] Helmet Headers  \u2192  [3] CORS Check\n"
    "        \u2193\n"
    "  [4] Rate Limiter (Redis)  \u2192  [5] IP Block Check\n"
    "        \u2193\n"
    "  [6] CSRF Token Validation  \u2192  [7] Input Sanitization\n"
    "        \u2193\n"
    "  [8] JWT Authentication (RS256)  \u2192  [9] RBAC Authorization\n"
    "        \u2193\n"
    "  \u2705  Route Handler (Business Logic)"
)

txBox6 = slide6.shapes.add_textbox(Inches(0.3), Inches(0.8), Inches(8.5), Inches(3.5))
tf6 = txBox6.text_frame
tf6.word_wrap = False
p6 = tf6.paragraphs[0]
run6 = p6.add_run()
run6.text = middleware_diagram
run6.font.size = Pt(10)
run6.font.color.rgb = DARK
run6.font.name = "Courier New"

bullets6 = [
    "  \u2022  RS256 asymmetric JWT \u2014 private key signs tokens, public key verifies (15-min expiry)",
    "  \u2022  Redis-backed sliding window rate limiting \u2014 200 req/min per IP, 20 logins per 15 min",
    "  \u2022  CSRF double-submit cookie pattern on all state-changing requests",
    "  \u2022  Role-Based Access Control (RBAC) \u2014 19 roles, middleware-enforced on every route",
]
add_bullet_textbox(slide6, 0.3, 4.5, 12.7, 2.8, bullets6, font_size=14, color=DARK)

add_notes(slide6, "What makes this architecture robust is the middleware pipeline. Every request passes through 9 security layers before reaching business logic. This defense-in-depth approach means multiple layers must be bypassed for any attack to succeed.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 7 — MODULES
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 7: Modules...")
slide7 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide7, "System Modules \u2014 30+ Backend, 15+ Frontend")
add_accent_bar(slide7)

left_col = [
    ("\U0001f3e5 CLINICAL", True, TEAL),
    ("Patients, Appointments, Vitals, Prescriptions, Lab Orders,\nDischarge Summaries, Telemedicine, OT Scheduling", False, DARK),
    ("", False, DARK),
    ("\U0001f48a PHARMACY & LAB", True, TEAL),
    ("Medicine Database, Dispensing Queue, Lab Orders,\nLab Results, Blood Bank", False, DARK),
    ("", False, DARK),
    ("\U0001f4b0 FINANCE", True, TEAL),
    ("Billing, Payments, Insurance, Financial Summary,\nRazorpay Integration", False, DARK),
    ("", False, DARK),
    ("\U0001f465 HR & ADMIN", True, TEAL),
    ("User Management, Shifts, Leaves, Departments,\nPayroll, Analytics", False, DARK),
]

right_col = [
    ("\U0001f512 SECURITY & AUDIT", True, TEAL),
    ("Audit Logs (Hash-Chain), IP Blocking,\nSession Management, Incident Reports", False, DARK),
    ("", False, DARK),
    ("\U0001f4e6 OPERATIONS", True, TEAL),
    ("Inventory, Bed Matrix, QR Codes,\nVisitor Logs, Handover Notes", False, DARK),
    ("", False, DARK),
    ("\U0001f4ac COMMUNICATION", True, TEAL),
    ("Real-time Messaging, Notifications,\nBroadcasts, Telemedicine Signaling", False, DARK),
    ("", False, DARK),
    ("\U0001f310 PATIENT PORTAL", True, TEAL),
    ("Medical Timeline, Prescriptions, Lab Results,\nBills, Appointments", False, DARK),
]

def add_module_col(slide, x, y, w, h, items):
    txBox = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = txBox.text_frame
    tf.word_wrap = True
    first = True
    for text, bold, color in items:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        p.space_before = Pt(2)
        run = p.add_run()
        run.text = text
        run.font.size = Pt(12)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = "Calibri"

add_module_col(slide7, 0.3, 0.8, 6.2, 6.5, left_col)
add_module_col(slide7, 6.8, 0.8, 6.2, 6.5, right_col)

add_notes(slide7, "The system is organized into 8 functional categories. Each backend module has its own routes, controller, service layer, and Zod validation schema. This modular design means new features can be added without touching existing code.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 8 — CORE CLINICAL FEATURES
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 8: Core Clinical Features...")
slide8 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide8, "Core Clinical Features")
add_accent_bar(slide8)

bullets8 = [
    "  \u2022  Patient Registration & MRN: Receptionist creates patient \u2192 system auto-generates unique Medical Record Number",
    "  \u2022  Appointment Scheduling: Supports in-person, telemedicine, and follow-up types with doctor availability",
    "  \u2022  Vital Signs Recording: Nurses record temperature, BP, pulse, SpO2, respiratory rate, BMI \u2014 alerts for abnormal values",
    "  \u2022  Prescription Management: Doctors write from medicine database; pharmacists see live dispensing queue; PDF download available",
    "  \u2022  Lab Order Workflow: Doctor orders \u2192 Lab tech records results \u2192 Doctor reviews \u2192 Patient notified via Socket.io",
    "  \u2022  Discharge Summaries: Auto-generated PDF (via Puppeteer) with diagnosis, medications, and follow-up instructions",
]
add_bullet_textbox(slide8, 0.4, 0.85, 12.7, 6.3, bullets8, font_size=14, color=DARK)

add_notes(slide8, "The clinical workflow is the heart of the system. A patient's journey starts with registration, where they receive a unique MRN. Appointments are scheduled, vitals recorded, prescriptions written, labs ordered, and finally a discharge PDF is automatically generated. Every step is connected and audited.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 9 — OPERATIONAL FEATURES
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 9: Operational Features...")
slide9 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide9, "Operational Features")
add_accent_bar(slide9)

bullets9 = [
    "  \u2022  Bed Matrix: Real-time visual grid of all hospital beds \u2014 available, occupied, or under maintenance \u2014 with patient assignment",
    "  \u2022  Blood Bank: Tracks blood units by type, component, expiry date, and full transfusion history",
    "  \u2022  Inventory + QR Codes: Stock levels with reorder alerts; QR code generation and scanning for physical items",
    "  \u2022  OT Scheduling: Operating theater bookings with surgeon, anesthetist, and procedure assignment",
    "  \u2022  Shift & Leave Management: Staff scheduling, shift swap requests, leave applications with approval workflows and balance tracking",
    "  \u2022  Visitor Management: Check-in/out with badge tracking, relationship logging, and security officer access",
]
add_bullet_textbox(slide9, 0.4, 0.85, 12.7, 6.3, bullets9, font_size=14, color=DARK)

add_notes(slide9, "Beyond clinical care, the system manages physical and human resources. The bed matrix gives real-time bed availability. The blood bank tracks every unit from donation to transfusion. Inventory items have QR codes that can be scanned to update stock. HR functions like shifts and leaves are fully automated.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 10 — SECURITY FEATURES PART 1
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 10: Security Features Part 1...")
slide10 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide10, "Security Architecture \u2014 Layer 1")
add_accent_bar(slide10)

bullets10 = [
    "  \U0001f510  Argon2id Password Hashing \u2014 industry's strongest algorithm, resistant to GPU brute-force attacks",
    "  \U0001f511  RS256 JWT (Asymmetric Keys) \u2014 access tokens signed with private key, verified with public key; 15-min expiry",
    "  \U0001f504  Refresh Token Rotation \u2014 single-use tokens in Redis; each refresh issues a brand-new token",
    "  \U0001f6e1\ufe0f  CSRF Protection \u2014 double-submit cookie pattern; every state-changing request requires a valid CSRF token",
    "  \U0001f5c4\ufe0f  Field-Level Encryption \u2014 patient PII (email, phone, address) encrypted at rest using PostgreSQL pgcrypto",
    "  \U0001f9a0  File Virus Scanning \u2014 every uploaded file scanned with ClamScan antivirus before storage",
]
add_bullet_textbox(slide10, 0.4, 0.85, 12.7, 6.3, bullets10, font_size=14, color=DARK)

add_notes(slide10, "Security is built into every layer. Argon2id is specifically designed to be slow and memory-intensive to defeat brute-force attacks. JWTs use asymmetric RS256 keys — even if someone gets the public key, they cannot forge tokens. Patient PII is encrypted in the database itself, so even a database dump reveals nothing readable.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 11 — SECURITY FEATURES PART 2
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 11: Security Features Part 2...")
slide11 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide11, "Security Architecture \u2014 Layer 2")
add_accent_bar(slide11)

bullets11 = [
    "  \U0001f6a6  Rate Limiting \u2014 Redis sliding window: 20 login attempts/15 min; 200 API calls/min per IP",
    "  \U0001f512  Account Lockout \u2014 5 failed attempts \u2192 15-minute lockout + automatic email notification to user",
    "  \U0001f6ab  IP Blocking \u2014 admins can block specific IPs with optional expiry; checked on every request",
    "  \U0001f9f9  Input Sanitization \u2014 all data stripped of null bytes and control characters before processing",
    "  \U0001f510  Client-Side Payload Encryption \u2014 sensitive form data encrypted with AES-256-GCM before leaving the browser",
    "  \u26d3\ufe0f  Tamper-Evident Audit Logs \u2014 hash-chain: each log entry hashes the previous entry (like blockchain)",
]
add_bullet_textbox(slide11, 0.4, 0.85, 12.7, 6.3, bullets11, font_size=14, color=DARK)

add_notes(slide11, "The tamper-evident audit log is particularly unique. Most systems just store logs in a table. This system chains each entry to the previous one using cryptographic hashes — if anyone deletes or modifies a log entry, the chain breaks and the system detects it immediately. That's a feature normally found in financial or legal systems.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 12 — DATABASE DESIGN
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 12: Database Design...")
slide12 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide12, "Database Design \u2014 PostgreSQL (40+ Tables)")
add_accent_bar(slide12)

erd_diagram = (
    "  users \u2500\u2500\u2500\u2500 user_roles \u2500\u2500\u2500\u2500 departments\n"
    "    \u2502\n"
    "    \u251c\u2500\u2500 sessions (IP/UA hashed)\n"
    "    \u2502\n"
    "  patients \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "    \u2502\n"
    "    \u251c\u2500\u2500 appointments \u2500\u2500\u2500\u2500 medical_records\n"
    "    \u251c\u2500\u2500 vitals\n"
    "    \u251c\u2500\u2500 prescriptions \u2500\u2500\u2500\u2500 prescription_items \u2500\u2500\u2500\u2500 medicines\n"
    "    \u251c\u2500\u2500 lab_orders \u2500\u2500\u2500\u2500 lab_results\n"
    "    \u251c\u2500\u2500 discharge_summaries\n"
    "    \u2514\u2500\u2500 bills \u2500\u2500\u2500\u2500 bill_items \u2500\u2500\u2500\u2500 payments\n\n"
    "  rooms \u2500\u2500\u2500\u2500 beds \u2500\u2500\u2500\u2500 patients\n"
    "  ot_schedules \u2500\u2500\u2500\u2500 users (surgeon + anesthetist)\n"
    "  messages \u2500\u2500\u2500\u2500 message_groups\n"
    "  audit_logs (hash-chain verified)\n"
    "  blood_bank_units | inventory_items | shift_schedules"
)

txBox12 = slide12.shapes.add_textbox(Inches(0.3), Inches(0.8), Inches(8.5), Inches(4.5))
tf12 = txBox12.text_frame
tf12.word_wrap = False
p12 = tf12.paragraphs[0]
run12 = p12.add_run()
run12.text = erd_diagram
run12.font.size = Pt(9)
run12.font.color.rgb = DARK
run12.font.name = "Courier New"

bullets12 = [
    "  \u2022  Encrypted columns: email, phone, address, emergency contact (pgcrypto AES)",
    "  \u2022  DB transactions used for multi-step operations (patient creation, discharge)",
    "  \u2022  Indexes on foreign keys, MRN, employee_id, and timestamps for performance",
]
add_bullet_textbox(slide12, 0.3, 5.4, 12.7, 1.9, bullets12, font_size=14, color=DARK)

add_notes(slide12, "The database has 40+ tables organized around the patient as the central entity. Everything connects back to the patient. Sensitive columns are encrypted directly in the database. Multi-step operations use database transactions — either everything succeeds or nothing is saved.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 13 — API FLOW
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 13: API Flow...")
slide13 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide13, "API Flow \u2014 Prescription Workflow Example")
add_accent_bar(slide13)

api_flow = (
    "  1. DOCTOR writes prescription\n"
    "     \u2514\u2500\u25ba POST /api/prescriptions\n"
    "         \u2514\u2500\u25ba JWT verified \u2192 RBAC (DOCTOR only) \u2192 Zod validation\n"
    "             \u2514\u2500\u25ba Saved to DB \u2192 Pharmacist notified via Socket.io\n\n"
    "  2. PHARMACIST reviews queue\n"
    "     \u2514\u2500\u25ba GET /api/prescriptions  (pending filter)\n"
    "         \u2514\u2500\u25ba PATCH /api/prescriptions/:id/dispense\n"
    "             \u2514\u2500\u25ba Status updated \u2192 Patient notified in real-time\n\n"
    "  3. PATIENT downloads PDF\n"
    "     \u2514\u2500\u25ba GET /api/prescriptions/:id/pdf\n"
    "         \u2514\u2500\u25ba Puppeteer generates PDF \u2192 Returned as download\n\n"
    "  Every call: Request ID \u2192 Auth \u2192 RBAC \u2192 Validate \u2192 Execute \u2192 Audit Log"
)

txBox13 = slide13.shapes.add_textbox(Inches(0.3), Inches(0.8), Inches(12.7), Inches(6.3))
tf13 = txBox13.text_frame
tf13.word_wrap = False
p13 = tf13.paragraphs[0]
run13 = p13.add_run()
run13.text = api_flow
run13.font.size = Pt(11)
run13.font.color.rgb = DARK
run13.font.name = "Courier New"

add_notes(slide13, "Every API call follows the same pipeline. The prescription workflow shows how three different roles interact through the system in real time. Socket.io eliminates the need for page refreshes — the pharmacist sees new prescriptions instantly, and the patient is notified the moment their medication is dispensed.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 14 — USE CASES
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 14: Use Cases...")
slide14 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide14, "Real Use Cases From the Code")
add_accent_bar(slide14)

use_cases = [
    ("\U0001f9d1\u200d\u2695\ufe0f PATIENT PORTAL",
     "Patient logs in \u2192 views medical timeline \u2192 checks prescriptions \u2192 sees lab results \u2192 pays bill online"),
    ("\U0001f4f9 TELEMEDICINE",
     "Doctor initiates video call \u2192 Socket.io handles WebRTC signaling \u2192 post-call: doctor creates medical record + prescription"),
    ("\U0001f50d AUDIT INVESTIGATION",
     "Admin suspects unauthorized access \u2192 opens Audit Log Viewer \u2192 filters by user/date \u2192 verifies hash-chain integrity \u2192 flags suspicious entry"),
    ("\U0001f9b8 BLOOD BANK EMERGENCY",
     "Nurse checks Blood Bank module \u2192 filters O-negative units \u2192 checks expiry dates \u2192 requests unit \u2192 transfusion logged with full history"),
]

positions = [(0.3, 0.85), (6.8, 0.85), (0.3, 3.9), (6.8, 3.9)]
for (uc_title, uc_body), (ux, uy) in zip(use_cases, positions):
    # Box background
    box_bg = slide14.shapes.add_shape(1, Inches(ux), Inches(uy), Inches(6.2), Inches(2.8))
    box_bg.fill.solid()
    box_bg.fill.fore_color.rgb = LIGHT_BLUE
    box_bg.line.color.rgb = TEAL

    # Title
    tb_title = slide14.shapes.add_textbox(Inches(ux + 0.1), Inches(uy + 0.1), Inches(6.0), Inches(0.4))
    tf_t = tb_title.text_frame
    p_t = tf_t.paragraphs[0]
    run_t = p_t.add_run()
    run_t.text = uc_title
    run_t.font.size = Pt(13)
    run_t.font.bold = True
    run_t.font.color.rgb = TEAL
    run_t.font.name = "Calibri"

    # Body
    tb_body = slide14.shapes.add_textbox(Inches(ux + 0.1), Inches(uy + 0.55), Inches(6.0), Inches(2.1))
    tf_b = tb_body.text_frame
    tf_b.word_wrap = True
    p_b = tf_b.paragraphs[0]
    run_b = p_b.add_run()
    run_b.text = uc_body
    run_b.font.size = Pt(12)
    run_b.font.color.rgb = DARK
    run_b.font.name = "Calibri"

add_notes(slide14, "These are real workflows supported by actual code. The patient portal gives patients full visibility into their own care. The audit log has hash-chain verification that mathematically proves no entry has been tampered with. The blood bank tracks every unit from arrival to transfusion.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 15 — TECHNOLOGIES USED
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 15: Technologies Used...")
slide15 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide15, "Technology Stack")
add_accent_bar(slide15)

tech_rows = [
    ("React 18",                  "18.2.0 \u2014 UI framework with lazy-loaded routes"),
    ("Vite + PWA",                "5.0 \u2014 Build tool + offline/installable support"),
    ("Zustand",                   "5.0 \u2014 Client state management (sessionStorage persistence)"),
    ("TanStack Query",            "5.17 \u2014 Server state, caching, background refetch"),
    ("React Hook Form + Zod",     "7.72 + 4.3 \u2014 Forms and schema validation"),
    ("Recharts",                  "3.8 \u2014 Analytics and dashboard charts"),
    ("Socket.io Client",          "4.8.3 \u2014 Real-time WebSocket communication"),
    ("Node.js + Express",         "5.2.1 \u2014 REST API server"),
    ("PostgreSQL + pgcrypto",     "\u2014 \u2014 Relational DB + field-level encryption"),
    ("Redis + BullMQ",            "\u2014 \u2014 Sessions, rate limiting, async job queues"),
    ("Argon2id",                  "0.44 \u2014 Password hashing (PHC winner)"),
    ("Puppeteer",                 "22.0 \u2014 Headless Chrome PDF generation"),
    ("ClamScan",                  "2.4 \u2014 Antivirus file scanning"),
    ("Razorpay",                  "2.9.6 \u2014 Payment gateway integration"),
    ("Helmet + CSRF-CSRF",        "8.0 + 4.0 \u2014 Security headers + CSRF protection"),
]

from pptx.util import Inches, Pt
from pptx.oxml.ns import qn
from lxml import etree

tbl = slide15.shapes.add_table(
    len(tech_rows) + 1, 2,
    Inches(0.3), Inches(0.8),
    Inches(12.7), Inches(6.4)
).table

# Header row
for col_idx, header in enumerate(["Technology", "Version / Purpose"]):
    cell = tbl.cell(0, col_idx)
    cell.text = header
    cell.fill.solid()
    cell.fill.fore_color.rgb = NAVY
    p = cell.text_frame.paragraphs[0]
    run = p.runs[0]
    run.font.bold = True
    run.font.color.rgb = WHITE
    run.font.size = Pt(13)
    run.font.name = "Calibri"

# Data rows
for row_idx, (tech, desc) in enumerate(tech_rows):
    row_num = row_idx + 1
    bg = LIGHT_BLUE if row_idx % 2 == 0 else WHITE

    cell0 = tbl.cell(row_num, 0)
    cell0.text = tech
    cell0.fill.solid()
    cell0.fill.fore_color.rgb = bg
    p0 = cell0.text_frame.paragraphs[0]
    run0 = p0.runs[0]
    run0.font.bold = True
    run0.font.color.rgb = DARK_TEAL
    run0.font.size = Pt(11)
    run0.font.name = "Calibri"

    cell1 = tbl.cell(row_num, 1)
    cell1.text = desc
    cell1.fill.solid()
    cell1.fill.fore_color.rgb = bg
    p1 = cell1.text_frame.paragraphs[0]
    run1 = p1.runs[0]
    run1.font.color.rgb = DARK
    run1.font.size = Pt(11)
    run1.font.name = "Calibri"

add_notes(slide15, "The technology choices reflect a modern, production-ready stack. Express 5 has improved async error handling. Argon2id won the Password Hashing Competition and is recommended over bcrypt. Puppeteer runs headless Chrome on the server to generate PDFs. ClamScan is an open-source antivirus integrated into the upload pipeline.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 16 — ADVANTAGES
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 16: Advantages...")
slide16 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide16, "Key Advantages")
add_accent_bar(slide16)

bullets16 = [
    "  \u2705  Truly Role-Based: 19 roles with granular permissions \u2014 no role can access another's data",
    "  \u2705  Defense in Depth: 9 middleware layers + field encryption + payload encryption = multiple security barriers",
    "  \u2705  Real-Time Everything: Socket.io powers live chat, notifications, telemedicine, and force-logout \u2014 no polling",
    "  \u2705  Tamper-Evident Audit Trail: Hash-chain verification makes logs mathematically provable \u2014 unique in most HMS systems",
    "  \u2705  PWA Support: Works offline, installable on mobile \u2014 critical for hospital environments with poor connectivity",
    "  \u2705  Automated Workflows: PDF generation, email notifications, virus scanning run asynchronously via BullMQ job queues",
]
add_bullet_textbox(slide16, 0.4, 0.85, 12.7, 6.3, bullets16, font_size=14, color=DARK)

add_notes(slide16, "The biggest advantage is that security and real-time capability are core to the architecture, not add-ons. The tamper-evident audit log is particularly unique — most hospital systems just store logs in a table. This system chains each entry with cryptographic hashes, so deletion or modification is immediately detectable.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 17 — LIMITATIONS
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 17: Limitations...")
slide17 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide17, "Current Limitations")
add_accent_bar(slide17)

bullets17 = [
    "  \u26a0\ufe0f  Telemedicine Provider: Video signaling uses Socket.io but actual video stream depends on external provider (Twilio/Jitsi) \u2014 not fully self-hosted",
    "  \u26a0\ufe0f  Single Hospital: Designed for one hospital instance \u2014 no multi-tenant or multi-branch support currently",
    "  \u26a0\ufe0f  No CI/CD Pipeline: No automated deployment pipeline or Kubernetes configuration \u2014 manual setup required",
    "  \u26a0\ufe0f  Radiology Module: Radiologist role exists in RBAC but the full radiology report module is partially scaffolded",
    "  \u26a0\ufe0f  Payment Geography: Razorpay integration is limited to Indian payment methods \u2014 no international payment support",
    "  \u26a0\ufe0f  iOS PWA: PWA works on Android but native push notifications are limited on iOS Safari",
]
add_bullet_textbox(slide17, 0.4, 0.85, 12.7, 6.3, bullets17, font_size=14, color=DARK)

add_notes(slide17, "Being honest about limitations is important. The telemedicine feature works but relies on an external video provider. The system is designed for a single hospital — multi-branch support would require architectural changes. The radiology module has roles and permissions defined but the full UI is partially implemented.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 18 — FUTURE ENHANCEMENTS
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 18: Future Enhancements...")
slide18 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide18, "Future Enhancements")
add_accent_bar(slide18)

bullets18 = [
    "  \U0001f680  AI-Powered Diagnostics: ML models for vital sign anomaly detection and drug interaction warnings",
    "  \U0001f3e2  Multi-Tenant Architecture: Support multiple hospital branches with complete data isolation",
    "  \U0001f517  HL7/FHIR Integration: Standard healthcare data exchange for interoperability with other hospital systems",
    "  \U0001f4f1  Native Mobile Apps: React Native apps for iOS and Android with full offline sync",
    "  \U0001f4ca  Predictive Analytics: Bed occupancy forecasting, patient readmission risk scoring, revenue prediction",
    "  \U0001f4b3  Automated Insurance Billing: Insurance claim submission and reconciliation with providers",
]
add_bullet_textbox(slide18, 0.4, 0.85, 12.7, 6.3, bullets18, font_size=14, color=DARK)

add_notes(slide18, "The foundation is solid enough to support significant enhancements. AI integration using the vitals data already being collected could detect early warning signs of patient deterioration. FHIR integration would allow data exchange with other hospital systems, increasingly required by healthcare regulations. Multi-tenant support would make this commercially viable as a SaaS product.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 19 — CONCLUSION
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 19: Conclusion...")
slide19 = prs.slides.add_slide(BLANK_LAYOUT)
add_title_bar(slide19, "Conclusion")
add_accent_bar(slide19)

bullets19 = [
    "  \u2022  Built a production-grade HMS covering the complete hospital workflow end-to-end",
    "  \u2022  Supports 19 user roles with strict RBAC across 30+ independent modules",
    "  \u2022  Implements enterprise-level security: Argon2id, RS256 JWT, pgcrypto, CSRF, virus scanning, hash-chain audit logs",
    "  \u2022  Enables real-time collaboration via Socket.io for messaging, notifications, and telemedicine",
    "  \u2022  Designed as a PWA for cross-device accessibility including offline support",
    "  \u2022  Demonstrates how modern web technologies can solve real healthcare challenges",
]
add_bullet_textbox(slide19, 0.4, 0.85, 12.7, 5.0, bullets19, font_size=14, color=DARK)

# Quote box
quote_box = slide19.shapes.add_shape(1, Inches(0.5), Inches(6.0), Inches(12.33), Inches(0.9))
quote_box.fill.solid()
quote_box.fill.fore_color.rgb = NAVY
quote_box.line.fill.background()

tb_quote = slide19.shapes.add_textbox(Inches(0.6), Inches(6.05), Inches(12.13), Inches(0.8))
tf_q = tb_quote.text_frame
tf_q.word_wrap = True
p_q = tf_q.paragraphs[0]
p_q.alignment = PP_ALIGN.CENTER
run_q = p_q.add_run()
run_q.text = "\u201cThis system doesn\u2019t just manage a hospital \u2014 it secures it, connects it, and makes it smarter.\u201d"
run_q.font.size = Pt(14)
run_q.font.italic = True
run_q.font.color.rgb = TEAL
run_q.font.name = "Calibri"

add_notes(slide19, "To summarize: this system goes far beyond a typical project. It implements security patterns used in banking, real-time features used in communication platforms, and clinical workflows used in actual hospital software. Every feature shown today is backed by real, working code — not mockups or assumptions.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 20 — THANK YOU
# ════════════════════════════════════════════════════════════════════════════
print("Adding Slide 20: Thank You...")
slide20 = prs.slides.add_slide(BLANK_LAYOUT)
add_navy_bg(slide20)

# Thank You
add_textbox(slide20, 0.5, 1.4, 12.33, 0.9,
            "Thank You", 44, bold=True, color=WHITE, align=PP_ALIGN.CENTER)

# Questions
add_textbox(slide20, 0.5, 2.4, 12.33, 0.5,
            "Questions & Discussion", 20, color=TEAL, align=PP_ALIGN.CENTER)

# Divider
add_hline(slide20, 1.5, 3.1, 10.33)

# Row 1 badges
row1_badges = ["19 User Roles", "30+ Modules", "40+ DB Tables", "9 Security Layers"]
badge_w = 2.5
badge_gap = 0.25
start_x = (13.33 - (4 * badge_w + 3 * badge_gap)) / 2
for i, badge in enumerate(row1_badges):
    bx = start_x + i * (badge_w + badge_gap)
    add_badge_box(slide20, bx, 3.4, badge_w, 0.5, badge, font_size=11)

# Row 2 badges
row2_badges = ["Real-time Chat", "Telemedicine", "PDF Generation", "Virus Scanning"]
for i, badge in enumerate(row2_badges):
    bx = start_x + i * (badge_w + badge_gap)
    add_badge_box(slide20, bx, 4.05, badge_w, 0.5, badge, font_size=11)

# Bottom contact
add_textbox(slide20, 0.5, 6.8, 12.33, 0.4,
            "[Your Email]  |  [GitHub Link]",
            12, color=WHITE, align=PP_ALIGN.CENTER)

add_notes(slide20, "Thank you for your attention. I'm happy to answer any questions about the technical implementation, security architecture, or clinical workflows. If you'd like a live demo of any specific feature, I can walk you through it.")

# ════════════════════════════════════════════════════════════════════════════
# SAVE
# ════════════════════════════════════════════════════════════════════════════
output_path = "HMS_Presentation_Final.pptx"
prs.save(output_path)
print(f"\n✅ Presentation saved: {output_path}")
print(f"   Total slides: {len(prs.slides)}")
