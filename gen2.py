from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from lxml import etree

# ── Colors
NAVY      = RGBColor(0x0D,0x21,0x37)
TEAL      = RGBColor(0x00,0xB4,0xD8)
DTEAL     = RGBColor(0x00,0x96,0xB7)
WHITE     = RGBColor(0xFF,0xFF,0xFF)
LBLUE     = RGBColor(0xE8,0xF4,0xF8)
DARK      = RGBColor(0x1E,0x29,0x3B)
GREEN     = RGBColor(0x22,0xC5,0x5E)
RED       = RGBColor(0xEF,0x44,0x44)
YELLOW    = RGBColor(0xF5,0x9E,0x0B)
LGRAY     = RGBColor(0xF1,0xF5,0xF9)
MGRAY     = RGBColor(0x94,0xA3,0xB8)

prs = Presentation()
prs.slide_width  = Inches(13.33)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

# ── Core helpers
def rect(slide, x, y, w, h, fill, line=None, radius=False):
    st = 5 if radius else 1
    s = slide.shapes.add_shape(st, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid(); s.fill.fore_color.rgb = fill
    if line: s.line.color.rgb = line
    else: s.line.fill.background()
    return s

def tb(slide, x, y, w, h, text, sz, bold=False, italic=False,
       color=WHITE, align=PP_ALIGN.CENTER, wrap=True, font="Calibri"):
    t = slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h))
    tf = t.text_frame; tf.word_wrap = wrap
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = text
    r.font.size=Pt(sz); r.font.bold=bold; r.font.italic=italic
    r.font.color.rgb=color; r.font.name=font
    return t

def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text

def title_bar(slide, text):
    rect(slide,0,0,13.33,0.72,NAVY)
    tb(slide,0.3,0.1,12.7,0.55,text,20,bold=True,color=WHITE,align=PP_ALIGN.LEFT)

def accent(slide):
    rect(slide,0,0.72,0.12,6.78,TEAL)

def hline(slide,x,y,w,c=TEAL):
    rect(slide,x,y,w,0.025,c)

def navy_bg(slide):
    rect(slide,0,0,13.33,7.5,NAVY)

def badge(slide,x,y,w,h,text,sz=11,fill=TEAL,tc=WHITE):
    s=rect(slide,x,y,w,h,fill,radius=True)
    s.line.fill.background()
    tf=s.text_frame; tf.word_wrap=False
    p=tf.paragraphs[0]; p.alignment=PP_ALIGN.CENTER
    r=p.add_run(); r.text=text
    r.font.size=Pt(sz); r.font.bold=True
    r.font.color.rgb=tc; r.font.name="Calibri"

def bullets_centered(slide, x, y, w, h, items, sz=14, color=DARK, spacing=6):
    t = slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h))
    tf = t.text_frame; tf.word_wrap = True
    first=True
    for item in items:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first=False
        p.alignment = PP_ALIGN.LEFT
        p.space_before = Pt(spacing)
        p.space_after  = Pt(2)
        r=p.add_run(); r.text=item
        r.font.size=Pt(sz); r.font.color.rgb=color; r.font.name="Calibri"

# ── Flowchart helpers
def flow_box(slide,x,y,w,h,text,fill=TEAL,tc=WHITE,sz=10,bold=True):
    s=rect(slide,x,y,w,h,fill,line=DTEAL,radius=True)
    t=slide.shapes.add_textbox(Inches(x+0.05),Inches(y+0.02),Inches(w-0.1),Inches(h-0.04))
    tf=t.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.alignment=PP_ALIGN.CENTER
    r=p.add_run(); r.text=text
    r.font.size=Pt(sz); r.font.bold=bold; r.font.color.rgb=tc; r.font.name="Calibri"

def flow_diamond(slide,x,y,w,h,text,fill=YELLOW,tc=DARK,sz=9):
    from pptx.util import Inches as I
    s=slide.shapes.add_shape(4,I(x),I(y),I(w),I(h))
    s.fill.solid(); s.fill.fore_color.rgb=fill
    s.line.color.rgb=RGBColor(0xD9,0x7F,0x06)
    t=slide.shapes.add_textbox(I(x+0.05),I(y+0.05),I(w-0.1),I(h-0.1))
    tf=t.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.alignment=PP_ALIGN.CENTER
    r=p.add_run(); r.text=text
    r.font.size=Pt(sz); r.font.bold=True; r.font.color.rgb=tc; r.font.name="Calibri"

def arrow_down(slide,x,y,h=0.25,c=MGRAY):
    rect(slide,x,y,0.025,h,c)
    # arrowhead triangle
    from pptx.util import Inches as I
    s=slide.shapes.add_shape(5,I(x-0.07),I(y+h),I(0.16),I(0.12))
    s.fill.solid(); s.fill.fore_color.rgb=c; s.line.fill.background()

def arrow_right(slide,x,y,w=0.3,c=MGRAY):
    rect(slide,x,y,w,0.025,c)
    from pptx.util import Inches as I
    s=slide.shapes.add_shape(5,I(x+w),I(y-0.06),I(0.12),I(0.14))
    s.fill.solid(); s.fill.fore_color.rgb=c; s.line.fill.background()


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 1 — TITLE
# ════════════════════════════════════════════════════════════════════════════
print("Slide 1: Title")
s=prs.slides.add_slide(BLANK)
navy_bg(s)
rect(s,0,4.9,13.33,2.6,DTEAL)
hline(s,0,4.85,13.33,TEAL)
tb(s,0.5,0.7,12.33,1.1,"Hospital Management System (HMS)",38,bold=True,color=WHITE,align=PP_ALIGN.CENTER)
tb(s,0.5,1.9,12.33,0.6,"A Full-Stack, Role-Based, Secure Healthcare Platform",18,italic=True,color=TEAL,align=PP_ALIGN.CENTER)
hline(s,1.5,2.7,10.33)
tb(s,0.5,2.85,12.33,0.5,"Digitize  |  Secure  |  Connect  |  Automate",14,color=LBLUE,align=PP_ALIGN.CENTER)
bgs=[("19 User Roles",0.5),("30+ API Modules",3.1),("40+ DB Tables",5.7),("Real-Time + PWA",8.3),("9 Security Layers",10.9)]
for txt,bx in bgs:
    badge(s,bx,3.5,2.3,0.48,txt,10)
tb(s,0.5,5.1,12.33,0.4,"Presented by: [Your Name]  |  [Institution]  |  April 2026",12,color=WHITE,align=PP_ALIGN.CENTER)
tb(s,0.5,5.6,12.33,1.2,
   "A comprehensive web-based platform that digitizes every hospital workflow\n"
   "from patient registration to discharge, billing, HR, and real-time communication.",
   13,italic=True,color=LBLUE,align=PP_ALIGN.CENTER)
notes(s,"Welcome everyone. Today I present our Hospital Management System — a production-grade full-stack web application that covers every department of a modern hospital. It supports 19 user roles, 30+ API modules, and is secured with enterprise-grade security including Argon2id hashing, RS256 JWT, field-level encryption, and tamper-evident audit logs.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 2 — INTRODUCTION
# ════════════════════════════════════════════════════════════════════════════
print("Slide 2: Introduction")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Introduction — What Is This System?")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.3,[
    "  \u2022  A web-based Hospital Management System (HMS) built to digitize real hospital operations end-to-end",
    "  \u2022  Supports 19 distinct user roles: Doctor, Nurse, Receptionist, Pharmacist, Lab Tech, Billing, HR, Admin, IT, Radiologist,",
    "       Anesthetist, Dietitian, Physio, Social Worker, Security Officer, Orderly, Inventory Manager, and Patient Portal",
    "  \u2022  Manages the complete patient journey: Registration \u2192 Appointment \u2192 Consultation \u2192 Vitals \u2192 Prescription",
    "       \u2192 Lab Tests \u2192 Treatment \u2192 Discharge \u2192 Billing \u2192 Follow-up",
    "  \u2022  Real-time communication: live chat between departments, instant notifications, telemedicine video calls",
    "  \u2022  Built as a Progressive Web App (PWA) \u2014 installable on mobile devices, works offline with service worker caching",
    "  \u2022  Every single action is logged in a tamper-evident, hash-chain verified audit trail",
    "  \u2022  Example: A doctor in Ward 3 writes a prescription \u2192 the pharmacist on Floor 1 sees it instantly without refreshing",
    "  \u2022  Example: Admin blocks a suspicious IP address \u2192 that IP is rejected on the very next request, system-wide",
],sz=13,color=DARK,spacing=4)
notes(s,"This is not a simple CRUD app. It mirrors how a real hospital operates. Every department has its own purpose-built dashboard. The 19 roles each have different permissions — a nurse cannot access billing, a billing clerk cannot see prescriptions. The PWA means staff can install it on their phones and use it even without internet connectivity.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 3 — PROBLEM STATEMENT
# ════════════════════════════════════════════════════════════════════════════
print("Slide 3: Problem Statement")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Problem Statement — Why This System Is Needed")
accent(s)
# Two column layout
rect(s,0.2,0.82,6.3,6.55,RGBColor(0xFF,0xF0,0xF0))
rect(s,6.8,0.82,6.3,6.55,LGRAY)
tb(s,0.3,0.88,6.1,0.4,"\u274c  Current Problems",13,bold=True,color=RED,align=PP_ALIGN.LEFT)
bullets_centered(s,0.3,1.3,6.1,5.8,[
    "  \u2022  Paper-based records: doctors write prescriptions by hand, nurses record vitals in notebooks",
    "  \u2022  Data silos: patient info exists separately in lab, pharmacy, billing — no unified view",
    "  \u2022  No real-time coordination: pharmacist doesn't know a prescription was written until physically handed a paper",
    "  \u2022  Manual billing: staff manually calculate charges, leading to errors and revenue leakage",
    "  \u2022  Zero audit trail: impossible to know who accessed or changed a patient record",
    "  \u2022  Security gaps: shared passwords, no session management, no encryption of sensitive data",
    "  \u2022  Scheduling chaos: shift swaps and leave requests handled via WhatsApp or paper forms",
],sz=12,color=DARK,spacing=5)
tb(s,6.9,0.88,6.1,0.4,"\u2705  How Our System Solves It",13,bold=True,color=GREEN,align=PP_ALIGN.LEFT)
bullets_centered(s,6.9,1.3,6.1,5.8,[
    "  \u2022  Digital records: all data stored in PostgreSQL with field-level encryption for PII",
    "  \u2022  Unified platform: one system for all 19 roles with role-filtered views",
    "  \u2022  Socket.io real-time: pharmacist sees new prescription the instant doctor saves it",
    "  \u2022  Automated billing: bill items auto-generated from prescriptions, labs, and procedures",
    "  \u2022  Hash-chain audit logs: every change recorded with user, IP, timestamp, and prev/next data",
    "  \u2022  Argon2id + RS256 JWT + pgcrypto: multi-layer security on every request",
    "  \u2022  Digital HR: shift scheduling, leave applications, and approvals all in-system",
],sz=12,color=DARK,spacing=5)
notes(s,"The core problem is fragmentation. In most hospitals, a doctor writes a prescription on paper, a nurse records vitals in a notebook, and billing is done on a separate spreadsheet. There is no single source of truth. This leads to medical errors, data loss, and security breaches. Our system solves this by bringing every department onto one unified, secure, real-time platform.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 4 — OBJECTIVES
# ════════════════════════════════════════════════════════════════════════════
print("Slide 4: Objectives")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Project Objectives")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.4,[
    "  \U0001f3af  Digitize all hospital workflows \u2014 clinical, administrative, and operational \u2014 eliminating paper-based processes",
    "  \U0001f512  Enforce strict role-based access control (RBAC) so each of the 19 roles sees only authorized data",
    "  \U0001f4ac  Enable real-time collaboration: live messaging, instant notifications, and telemedicine video calls",
    "  \U0001f6e1\ufe0f  Secure patient data with Argon2id hashing, RS256 JWT, pgcrypto field encryption, CSRF protection, and virus scanning",
    "  \u26d3\ufe0f  Maintain a tamper-evident audit trail: every action logged with hash-chain verification (like blockchain)",
    "  \U0001f916  Automate routine tasks: PDF generation, email alerts, inventory reorder notifications via BullMQ job queues",
    "  \U0001f4ca  Provide analytics dashboards: bed occupancy, revenue trends, failed login attempts, department statistics",
    "  \U0001f4f1  Build as a PWA: cross-device support, offline capability, installable on mobile without an app store",
    "  \U0001f9fe  Integrate payment gateway (Razorpay) for real online bill payments by patients",
    "  \U0001f4c4  Auto-generate professional PDF documents: prescriptions, discharge summaries, lab reports via Puppeteer",
],sz=13,color=DARK,spacing=4)
notes(s,"Our objectives were clear from the start: digitize, secure, and connect. Every hospital role gets a purpose-built interface. Every action is audited. Every piece of sensitive data is encrypted. The system also automates routine tasks like sending low-stock alerts or generating PDF discharge summaries automatically.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 5 — SYSTEM OVERVIEW (Architecture)
# ════════════════════════════════════════════════════════════════════════════
print("Slide 5: System Overview")
s=prs.slides.add_slide(BLANK)
title_bar(s,"System Overview — Three-Tier Architecture")
accent(s)

# Draw architecture boxes using shapes
# Frontend box
rect(s,0.25,0.85,12.8,1.15,RGBColor(0x00,0x4E,0x7C))
tb(s,0.3,0.88,12.7,0.35,"FRONTEND LAYER — React 18 PWA",12,bold=True,color=TEAL,align=PP_ALIGN.CENTER)
tb(s,0.3,1.22,12.7,0.7,
   "19 Role-Based Dashboards  |  Zustand State  |  TanStack Query  |  React Router v6  |  Socket.io Client  |  SCSS Modules  |  Recharts  |  QR Scanner  |  react-window  |  Framer Motion",
   10,color=WHITE,align=PP_ALIGN.CENTER)

# Arrow down
rect(s,6.6,2.05,0.12,0.35,TEAL)
tb(s,6.0,2.38,1.3,0.25,"HTTPS + WSS",9,color=MGRAY,align=PP_ALIGN.CENTER)

# Backend box
rect(s,0.25,2.65,12.8,1.15,RGBColor(0x00,0x4E,0x7C))
tb(s,0.3,2.68,12.7,0.35,"BACKEND LAYER — Node.js + Express 5",12,bold=True,color=TEAL,align=PP_ALIGN.CENTER)
tb(s,0.3,3.02,12.7,0.7,
   "30+ API Modules  |  JWT RS256 Auth  |  Socket.io Server  |  BullMQ Job Queues  |  Multer + ClamScan  |  Puppeteer PDF  |  Nodemailer  |  Zod Validation  |  Winston Logging  |  Helmet + CSRF",
   10,color=WHITE,align=PP_ALIGN.CENTER)

# Two arrows down
rect(s,3.5,3.85,0.12,0.35,TEAL)
rect(s,9.5,3.85,0.12,0.35,TEAL)

# DB box
rect(s,0.25,4.25,5.9,1.3,RGBColor(0x00,0x4E,0x7C))
tb(s,0.3,4.28,5.8,0.35,"DATABASE — PostgreSQL",12,bold=True,color=TEAL,align=PP_ALIGN.CENTER)
tb(s,0.3,4.62,5.8,0.85,"40+ Tables  |  pgcrypto PII Encryption\nTransactions  |  Indexes  |  Migrations",10,color=WHITE,align=PP_ALIGN.CENTER)

# Redis box
rect(s,7.15,4.25,5.9,1.3,RGBColor(0x00,0x4E,0x7C))
tb(s,7.2,4.28,5.8,0.35,"CACHE & QUEUE — Redis + BullMQ",12,bold=True,color=TEAL,align=PP_ALIGN.CENTER)
tb(s,7.2,4.62,5.8,0.85,"Sessions  |  Refresh Tokens  |  Rate Limiting\nJob Queues  |  Blocked IPs Cache",10,color=WHITE,align=PP_ALIGN.CENTER)

# Bottom note
rect(s,0.25,5.7,12.8,0.55,NAVY)
tb(s,0.3,5.72,12.7,0.5,
   "All layers communicate over HTTPS/WSS  |  Redis decouples sessions from DB  |  BullMQ handles async tasks non-blocking",
   11,color=TEAL,align=PP_ALIGN.CENTER)

notes(s,"The system follows a three-tier architecture with additional layers. Redis handles sessions and rate limiting independently from the database. Socket.io enables real-time features. The backend is organized into 30+ independent modules. BullMQ handles async tasks like email sending and file processing so they don't block the main request thread.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 6 — MIDDLEWARE PIPELINE FLOWCHART
# ════════════════════════════════════════════════════════════════════════════
print("Slide 6: Middleware Pipeline Flowchart")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Request Lifecycle — 9-Layer Middleware Pipeline (Flowchart)")
accent(s)

# Draw flowchart left-to-right in 3 rows
# Row 1: steps 1-3
bw=3.6; bh=0.52; gap=0.18; sy=0.88; sx=0.22
steps=[
    ("1. Request ID\nAssign UUID to every request",TEAL),
    ("2. Helmet Headers\nCSP, X-Frame, X-Content-Type",TEAL),
    ("3. CORS Check\nWhitelist origin validation",TEAL),
    ("4. Rate Limiter\nRedis: 200/min API, 20/15min login",RGBColor(0x7C,0x3A,0xED)),
    ("5. IP Block Check\nReject admin-blocked IPs instantly",RGBColor(0x7C,0x3A,0xED)),
    ("6. CSRF Validation\nDouble-submit cookie pattern",RGBColor(0x7C,0x3A,0xED)),
    ("7. Input Sanitize\nStrip null bytes & control chars",RGBColor(0xD9,0x7F,0x06)),
    ("8. JWT Auth (RS256)\nVerify asymmetric token, 15-min TTL",RGBColor(0xD9,0x7F,0x06)),
    ("9. RBAC Check\n19 roles, route-level enforcement",RGBColor(0xD9,0x7F,0x06)),
]
positions=[]
for i in range(3):
    for j in range(3):
        px=sx+j*(bw+gap)
        py=sy+i*(bh+0.55)
        positions.append((px,py))

for i,(txt,fill) in enumerate(steps):
    px,py=positions[i]
    flow_box(s,px,py,bw,bh,txt,fill=fill,sz=10)
    # arrow right (not last in row)
    if i%3!=2:
        rect(s,px+bw+0.02,py+bh/2-0.012,gap-0.04,0.025,MGRAY)
    # arrow down (end of row, not last row)
    if i%3==2 and i<6:
        rect(s,px+bw/2-0.012,py+bh,0.025,0.55,MGRAY)

# Final result box
rect(s,0.22,6.1,12.85,0.62,GREEN)
tb(s,0.25,6.12,12.8,0.58,
   "\u2705  ROUTE HANDLER — Business Logic Executes  |  Response returned  |  Audit log written",
   13,bold=True,color=WHITE,align=PP_ALIGN.CENTER)

notes(s,"Every single request — before it even reaches the business logic — passes through 9 security layers. This defense-in-depth approach means multiple layers must be bypassed for any attack to succeed. For example, even if an attacker has a valid JWT, they still need to pass the RBAC check. Even if they pass RBAC, their input is still sanitized.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 7 — MODULES OVERVIEW
# ════════════════════════════════════════════════════════════════════════════
print("Slide 7: Modules")
s=prs.slides.add_slide(BLANK)
title_bar(s,"System Modules — 30+ Backend, 15+ Frontend Role Dashboards")
accent(s)

cats=[
    ("\U0001f3e5 CLINICAL","Patients, Appointments, Vitals,\nPrescriptions, Lab Orders,\nDischarge, Telemedicine, OT",TEAL),
    ("\U0001f48a PHARMACY & LAB","Medicine DB, Dispensing Queue,\nLab Orders, Lab Results,\nBlood Bank Management",DTEAL),
    ("\U0001f4b0 FINANCE","Billing, Payments, Insurance,\nFinancial Summary,\nRazorpay Integration",RGBColor(0x22,0xC5,0x5E)),
    ("\U0001f465 HR & ADMIN","User Mgmt, Shifts, Leaves,\nDepartments, Payroll,\nAnalytics Dashboard",RGBColor(0x7C,0x3A,0xED)),
    ("\U0001f512 SECURITY & AUDIT","Audit Logs (Hash-Chain),\nIP Blocking, Session Mgmt,\nIncident Reports",RED),
    ("\U0001f4e6 OPERATIONS","Inventory, Bed Matrix,\nQR Codes, Visitor Logs,\nHandover Notes",YELLOW),
    ("\U0001f4ac COMMUNICATION","Real-time Messaging,\nNotifications, Broadcasts,\nTelemedicine Signaling",RGBColor(0x06,0xB6,0xD4)),
    ("\U0001f310 PATIENT PORTAL","Medical Timeline, Prescriptions,\nLab Results, Bills,\nAppointments, File Downloads",RGBColor(0xF9,0x73,0x16)),
]
cw=3.0; ch=1.55; cgap=0.18
for i,( title,body,fill) in enumerate(cats):
    col=i%4; row=i//4
    cx=0.22+col*(cw+cgap)
    cy=0.85+row*(ch+0.18)
    rect(s,cx,cy,cw,ch,fill)
    tb(s,cx+0.08,cy+0.06,cw-0.16,0.38,title,11,bold=True,color=WHITE,align=PP_ALIGN.LEFT)
    hline(s,cx+0.08,cy+0.44,cw-0.16,WHITE)
    tb(s,cx+0.08,cy+0.5,cw-0.16,ch-0.56,body,9,color=WHITE,align=PP_ALIGN.LEFT,wrap=True)

notes(s,"The system is organized into 8 functional categories covering every aspect of hospital operations. Each backend module is independently structured with its own routes, controller, service layer, and Zod validation schema. This modular design means new features can be added without touching existing code.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 8 — PATIENT JOURNEY FLOWCHART
# ════════════════════════════════════════════════════════════════════════════
print("Slide 8: Patient Journey Flowchart")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Patient Journey — End-to-End Clinical Workflow (Flowchart)")
accent(s)

# Horizontal flowchart across the slide
steps8=[
    ("REGISTRATION\nReceptionist creates\npatient + MRN",TEAL),
    ("APPOINTMENT\nScheduled by\nReceptionist/Patient",DTEAL),
    ("CONSULTATION\nDoctor reviews\nhistory & vitals",RGBColor(0x7C,0x3A,0xED)),
    ("VITALS\nNurse records\nBP, Temp, SpO2",RGBColor(0x06,0xB6,0xD4)),
    ("PRESCRIPTION\nDoctor writes\nfrom medicine DB",RGBColor(0xD9,0x7F,0x06)),
    ("LAB TESTS\nOrdered by Doctor\nResults by Lab Tech",RGBColor(0xF9,0x73,0x16)),
    ("DISPENSING\nPharmacist dispenses\nmedication",GREEN),
    ("DISCHARGE\nSummary PDF\nauto-generated",RGBColor(0xEF,0x44,0x44)),
    ("BILLING\nAuto-itemized bill\nRazorpay payment",RGBColor(0x22,0xC5,0x5E)),
]
bw=1.28; bh=1.1; sy=1.05; sx=0.22; gap=0.1
for i,(txt,fill) in enumerate(steps8):
    cx=sx+i*(bw+gap)
    flow_box(s,cx,sy,bw,bh,txt,fill=fill,sz=9)
    if i<len(steps8)-1:
        rect(s,cx+bw+0.01,sy+bh/2-0.012,gap-0.02,0.025,MGRAY)

# Step numbers
for i in range(len(steps8)):
    cx=sx+i*(bw+gap)
    badge(s,cx+bw/2-0.18,sy-0.38,0.36,0.32,str(i+1),sz=10,fill=NAVY)

# Arrow label
tb(s,0.22,2.25,12.9,0.3,"Each step triggers real-time Socket.io notifications to the relevant role",11,italic=True,color=MGRAY,align=PP_ALIGN.CENTER)

# Example box
rect(s,0.22,2.62,12.9,1.05,NAVY)
tb(s,0.3,2.65,12.7,0.35,"\U0001f4cb  Real Example Flow:",12,bold=True,color=TEAL,align=PP_ALIGN.LEFT)
tb(s,0.3,3.0,12.7,0.62,
   "Patient 'John Doe' (MRN: HMS-2024-001) arrives \u2192 Receptionist registers him \u2192 Dr. Smith is notified \u2192 Nurse records BP=140/90 (flagged HIGH) \u2192 "
   "Dr. Smith prescribes Amlodipine 5mg \u2192 Pharmacist sees it instantly \u2192 Lab orders CBC \u2192 Results uploaded \u2192 "
   "Discharge PDF generated \u2192 Bill of \u20b92,450 sent to patient portal \u2192 Patient pays via Razorpay",
   10,color=WHITE,align=PP_ALIGN.LEFT,wrap=True)

# Sub-features
rect(s,0.22,3.75,12.9,3.6,LGRAY)
tb(s,0.3,3.8,12.7,0.35,"Key Clinical Features:",13,bold=True,color=NAVY,align=PP_ALIGN.LEFT)
bullets_centered(s,0.3,4.15,6.2,3.1,[
    "  \u2022  MRN auto-generated: HMS-YYYY-NNNN format, unique per patient",
    "  \u2022  Appointment types: In-Person, Telemedicine, Follow-up, Emergency",
    "  \u2022  Vitals alerts: SpO2 < 95%, BP > 140/90, Temp > 38.5\u00b0C flagged automatically",
    "  \u2022  Medicine database: searchable, with dosage, frequency, and interaction notes",
    "  \u2022  Lab workflow: 15+ test types, result interpretation, abnormal value flagging",
],sz=12,color=DARK,spacing=4)
bullets_centered(s,6.6,4.15,6.2,3.1,[
    "  \u2022  Prescription PDF: auto-generated with doctor signature block via Puppeteer",
    "  \u2022  Discharge summary: includes diagnosis, medications, follow-up date, doctor notes",
    "  \u2022  Telemedicine: Socket.io WebRTC signaling for video consultations",
    "  \u2022  OT Scheduling: surgeon + anesthetist assignment, procedure tracking",
    "  \u2022  Handover notes: shift-to-shift clinical handover documentation for nurses",
],sz=12,color=DARK,spacing=4)

notes(s,"The patient journey is the heart of the system. Every step is connected and audited. When a nurse records an abnormal vital sign, the doctor is notified instantly. When a doctor writes a prescription, the pharmacist sees it in their queue without refreshing. The entire journey from registration to billing is tracked in one unified system.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 9 — CORE FEATURES (CLINICAL)
# ════════════════════════════════════════════════════════════════════════════
print("Slide 9: Core Clinical Features")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Core Clinical Features — With Examples")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.4,[
    "  \U0001f3e5  Patient Registration & MRN: Receptionist fills form \u2192 system creates user account + patient record in one DB transaction",
    "       Example: Patient 'Sara Ali' gets MRN HMS-2024-042, temp password emailed, can log into patient portal immediately",
    "  \U0001f4c5  Appointment Scheduling: 3 types \u2014 In-Person, Telemedicine, Follow-up \u2014 with doctor availability calendar",
    "       Example: Patient books telemedicine with Dr. Ahmed for 3pm \u2192 both receive Socket.io notification + email reminder",
    "  \U0001f4c8  Vital Signs: Nurse records Temp, BP (systolic/diastolic), Pulse, SpO2, Respiratory Rate, BMI with timestamp",
    "       Example: SpO2 = 91% recorded \u2192 system flags as CRITICAL \u2192 doctor notified instantly via real-time alert",
    "  \U0001f48a  Prescription Management: Doctor selects from medicine DB, sets dosage/frequency/duration, adds notes",
    "       Example: 'Metformin 500mg twice daily for 30 days' \u2192 pharmacist queue updated \u2192 patient PDF ready in 2 seconds",
    "  \U0001f9ea  Lab Orders: Doctor orders CBC, LFT, RFT, etc. \u2192 Lab tech uploads results \u2192 doctor reviews \u2192 patient notified",
    "       Example: HbA1c result = 8.2% (HIGH) \u2192 auto-flagged \u2192 doctor sees red badge on lab results panel",
    "  \U0001f4cb  Discharge Summary: Auto-PDF with final diagnosis, all medications, follow-up date, doctor signature block",
    "       Example: Patient discharged \u2192 PDF generated in 3 seconds via Puppeteer \u2192 downloadable from patient portal",
],sz=12,color=DARK,spacing=3)
notes(s,"The clinical workflow is the heart of the system. Every step is connected and audited. When a nurse records an abnormal vital sign, the doctor is notified instantly. When a doctor writes a prescription, the pharmacist sees it in their queue without refreshing. The entire journey from registration to billing is tracked in one unified system.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 10 — OPERATIONAL FEATURES
# ════════════════════════════════════════════════════════════════════════════
print("Slide 10: Operational Features")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Operational Features — With Examples")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.4,[
    "  \U0001f6cf\ufe0f  Bed Matrix: Real-time grid of all beds \u2014 Available (green), Occupied (red), Maintenance (yellow) \u2014 with patient name",
    "       Example: Ward 2 has 3 available beds \u2014 receptionist assigns 'John Doe' to Bed 2B with one click",
    "  \U0001f9b8  Blood Bank: Tracks units by type (A+, O-, etc.), component (whole/plasma/platelets), expiry, and transfusion history",
    "       Example: Nurse searches O-negative \u2192 sees 4 units available, 1 expiring in 2 days \u2014 requests unit \u2192 logged with patient ID",
    "  \U0001f4e6  Inventory + QR Codes: Stock items with reorder levels; QR code printed on physical items for instant scan-to-update",
    "       Example: Nurse scans QR on IV bag \u2192 system deducts 1 unit from stock \u2192 if stock < 10, email alert sent to inventory manager",
    "  \U0001f3e5  OT Scheduling: Theater bookings with surgeon, anesthetist, procedure type, duration, and pre-op checklist",
    "       Example: Dr. Khan schedules appendectomy in OT-1 at 9am \u2192 anesthetist Dr. Raza auto-notified \u2192 OT calendar updated",
    "  \U0001f4c6  Shift & Leave Management: Staff scheduling with swap requests; leave applications with balance tracking and approval",
    "       Example: Nurse applies for 3 days leave \u2192 HR manager approves \u2192 leave balance deducted \u2192 shift auto-reassigned",
    "  \U0001f6b6  Visitor Management: Check-in/out with visitor name, relationship, badge number, and security officer log",
    "       Example: Visitor 'Ahmed (son of patient)' checked in at 2pm, badge #V-045 issued, checked out at 4pm \u2014 full log maintained",
],sz=12,color=DARK,spacing=3)
notes(s,"Beyond clinical care, the system manages the physical and human resources of the hospital. The bed matrix gives a real-time view of bed availability. The blood bank tracks every unit from donation to transfusion. Inventory items have QR codes that can be scanned to update stock. HR functions like shifts and leaves are fully automated with approval workflows.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 11 — SECURITY FLOWCHART (Login Flow)
# ════════════════════════════════════════════════════════════════════════════
print("Slide 11: Security Login Flowchart")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Security Architecture — Login Flow & Token Lifecycle (Flowchart)")
accent(s)

# Left side: Login flowchart
tb(s,0.22,0.82,6.0,0.35,"LOGIN FLOW",12,bold=True,color=NAVY,align=PP_ALIGN.CENTER)
rect(s,0.22,0.82,6.0,0.35,NAVY)
tb(s,0.22,0.82,6.0,0.35,"LOGIN FLOW",12,bold=True,color=WHITE,align=PP_ALIGN.CENTER)

lf=[
    ("User submits\nusername + password",TEAL,0.88),
    ("IP Blocked?",YELLOW,1.62),
    ("Rate Limited?\n(20 attempts/15min)",YELLOW,2.42),
    ("Account Locked?\n(5 fails = 15min lock)",YELLOW,3.22),
    ("Argon2id verify\npassword hash",TEAL,4.02),
    ("Issue RS256 JWT\n(15min) + Refresh Token\n(7 days, Redis)",GREEN,4.82),
]
for txt,fill,fy in lf:
    if fill==YELLOW:
        flow_diamond(s,0.35,fy,5.7,0.62,txt,fill=YELLOW,sz=9)
    else:
        flow_box(s,0.35,fy,5.7,0.62,txt,fill=fill,sz=9)
    if fy<4.82:
        rect(s,2.17,fy+0.62,0.025,0.18,MGRAY)

# Reject labels
for fy in [1.62,2.42,3.22]:
    tb(s,0.22,fy+0.22,0.35,0.25,"YES",8,bold=True,color=RED,align=PP_ALIGN.CENTER)
    tb(s,0.22,fy+0.22,0.35,0.25,"\u2192 BLOCK",8,color=RED,align=PP_ALIGN.LEFT)

# Right side: Token lifecycle
rect(s,6.55,0.82,6.55,0.35,NAVY)
tb(s,6.55,0.82,6.55,0.35,"TOKEN LIFECYCLE",12,bold=True,color=WHITE,align=PP_ALIGN.CENTER)

tl=[
    ("Access Token (JWT RS256)\n15-minute expiry\nContains: userId, role, sessionId",TEAL,0.88),
    ("Token Expires?",YELLOW,1.72),
    ("Send Refresh Token\n(opaque, stored in Redis)",DTEAL,2.52),
    ("Redis validates\nRefresh Token",TEAL,3.32),
    ("Issue NEW Access Token\n+ Rotate Refresh Token\n(old one invalidated)",GREEN,4.12),
    ("Force Logout:\nAdmin can delete session\nfrom Redis instantly",RED,4.92),
]
for txt,fill,ty in tl:
    if fill==YELLOW:
        flow_diamond(s,6.7,ty,6.2,0.62,txt,fill=YELLOW,sz=9)
    else:
        flow_box(s,6.7,ty,6.2,0.62,txt,fill=fill,sz=9)
    if ty<4.92:
        rect(s,9.77,ty+0.62,0.025,0.18,MGRAY)

rect(s,0.22,5.62,12.88,0.62,NAVY)
tb(s,0.3,5.64,12.7,0.58,
   "Example: Dr. Ahmed logs in at 9:00am \u2192 gets JWT (expires 9:15am) + Refresh Token \u2192 at 9:15am browser auto-refreshes \u2192 "
   "new JWT issued, old refresh token destroyed \u2192 if admin force-logouts Dr. Ahmed, Redis session deleted \u2192 next request rejected",
   10,italic=True,color=TEAL,align=PP_ALIGN.CENTER,wrap=True)

notes(s,"The login flow has multiple checkpoints. First the IP is checked against the blocked list. Then rate limiting is checked. Then account lockout status. Only then is the password verified with Argon2id. On success, an RS256 JWT is issued with a 15-minute expiry. Refresh tokens are single-use and stored in Redis — each refresh rotates the token, so stolen refresh tokens become invalid after one use.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 12 — SECURITY FEATURES DEEP DIVE
# ════════════════════════════════════════════════════════════════════════════
print("Slide 12: Security Features")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Security Features — Multi-Layer Defense")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.4,[
    "  \U0001f510  Argon2id Password Hashing: PHC winner, memory-hard, GPU-resistant. 1000x slower than MD5 for attackers",
    "       Example: Password 'abc123' stored as '$argon2id$v=19$m=65536,t=3,p=4$...' \u2014 uncrackable even with GPU farm",
    "  \U0001f511  RS256 JWT (Asymmetric): Private key signs tokens on server; public key verifies. Compromise of public key = useless",
    "       Example: Token payload: {userId:'u-123', role:'DOCTOR', exp:1713200000} \u2014 signed, not encrypted, but tamper-proof",
    "  \U0001f5c4\ufe0f  Field-Level Encryption (pgcrypto): email, phone, address, emergency contact encrypted in DB with AES",
    "       Example: DB column shows 'x0a3f...' not 'john@email.com' \u2014 even a DB admin cannot read PII without the key",
    "  \U0001f9a0  ClamScan Virus Scanning: Every uploaded file (PDF, image, doc) scanned before storage. Infected files rejected",
    "       Example: Nurse uploads patient file \u2192 ClamScan checks \u2192 if EICAR test signature found \u2192 file deleted, error returned",
    "  \u26d3\ufe0f  Hash-Chain Audit Logs: Each log row stores SHA-256 hash of previous row. Deletion breaks the chain",
    "       Example: Admin verifies chain \u2192 GET /api/admin/audit-logs/verify \u2192 returns {valid:true, entries:4821}",
    "  \U0001f510  AES-256-GCM Payload Encryption: Sensitive form data encrypted client-side before HTTP transmission",
    "       Example: Patient's address field encrypted in browser \u2192 even if HTTPS intercepted, payload is still ciphertext",
],sz=12,color=DARK,spacing=3)
notes(s,"Security is not an afterthought here — it is built into every layer. Argon2id is specifically designed to be slow and memory-intensive to defeat brute-force attacks. The hash-chain audit log is like a blockchain for hospital records — if anyone deletes or modifies a log entry, the chain breaks and the system detects it immediately.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 13 — DATABASE DESIGN
# ════════════════════════════════════════════════════════════════════════════
print("Slide 13: Database Design")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Database Design — PostgreSQL (40+ Tables, ERD Overview)")
accent(s)

# Draw ERD using shape boxes
def db_box(slide,x,y,w,h,title,fields,fill=NAVY,tc=TEAL):
    rect(slide,x,y,w,h,fill)
    tb(slide,x+0.05,y+0.04,w-0.1,0.28,title,9,bold=True,color=tc,align=PP_ALIGN.LEFT)
    hline(slide,x+0.05,y+0.32,w-0.1,tc)
    tb(slide,x+0.05,y+0.36,w-0.1,h-0.4,fields,8,color=WHITE,align=PP_ALIGN.LEFT,wrap=True)

# Row 1
db_box(s,0.22,0.85,2.4,1.35,"users","id, employee_id\nrole, dept_id\nstatus, created_at")
db_box(s,2.82,0.85,2.4,1.35,"patients","id, mrn, user_id\nbed_id, blood_group\nadmission_date")
db_box(s,5.42,0.85,2.4,1.35,"appointments","id, patient_id\ndoctor_id, type\nstatus, datetime")
db_box(s,8.02,0.85,2.4,1.35,"vitals","id, patient_id\ntemp, bp_sys, bp_dia\npulse, spo2, bmi")
db_box(s,10.62,0.85,2.5,1.35,"medical_records","id, patient_id\ndoctor_id, diagnosis\ntreatment_plan")

# Row 2
db_box(s,0.22,2.42,2.4,1.35,"prescriptions","id, patient_id\ndoctor_id, status\ndispensed_at")
db_box(s,2.82,2.42,2.4,1.35,"prescription_items","id, prescription_id\nmedicine_id, dosage\nfrequency, duration")
db_box(s,5.42,2.42,2.4,1.35,"lab_orders","id, patient_id\ndoctor_id, test_type\nstatus, result_id")
db_box(s,8.02,2.42,2.4,1.35,"bills","id, patient_id\ntotal, discount\ntax, status")
db_box(s,10.62,2.42,2.5,1.35,"payments","id, bill_id\namount, method\nrazorpay_id, status")

# Row 3
db_box(s,0.22,3.99,2.4,1.25,"rooms / beds","id, room_no, type\nbed_no, status\npatient_id (FK)")
db_box(s,2.82,3.99,2.4,1.25,"ot_schedules","id, surgeon_id\nanesthetist_id\nprocedure, theater")
db_box(s,5.42,3.99,2.4,1.25,"messages","id, group_id\nsender_id, content\nencrypted, read_at")
db_box(s,8.02,3.99,2.4,1.25,"audit_logs","id, user_id, action\nprev_hash, row_hash\nip, user_agent")
db_box(s,10.62,3.99,2.5,1.25,"blood_bank_units","id, blood_type\ncomponent, expiry\nstatus, patient_id")

# Connector lines (simplified)
for x in [1.42,4.02,6.62,9.22]:
    rect(s,x,2.2,0.025,0.22,TEAL)
for x in [1.42,4.02,6.62,9.22]:
    rect(s,x,3.77,0.025,0.22,TEAL)

# Bottom legend
rect(s,0.22,5.38,12.88,1.95,LGRAY)
tb(s,0.3,5.42,12.7,0.32,"Key Design Decisions:",12,bold=True,color=NAVY,align=PP_ALIGN.LEFT)
bullets_centered(s,0.3,5.74,6.2,1.5,[
    "  \u2022  Encrypted columns: email, phone, address (pgcrypto AES-256)",
    "  \u2022  DB transactions: patient creation, discharge use atomic transactions",
    "  \u2022  Indexes: MRN, employee_id, foreign keys, timestamps for fast queries",
],sz=11,color=DARK,spacing=3)
bullets_centered(s,6.6,5.74,6.2,1.5,[
    "  \u2022  Hash-chain: audit_logs.prev_hash = SHA256 of previous row",
    "  \u2022  Soft deletes: records marked inactive, never hard-deleted",
    "  \u2022  UUID primary keys: all tables use UUID v4 for security",
],sz=11,color=DARK,spacing=3)

notes(s,"The database has 40+ tables organized around the patient as the central entity. Everything connects back to the patient. Sensitive columns like email and phone are encrypted directly in the database using pgcrypto. Multi-step operations use database transactions — either everything succeeds or nothing is saved. UUID primary keys prevent enumeration attacks.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 14 — PRESCRIPTION WORKFLOW FLOWCHART
# ════════════════════════════════════════════════════════════════════════════
print("Slide 14: Prescription Workflow Flowchart")
s=prs.slides.add_slide(BLANK)
title_bar(s,"API Flow — Prescription Workflow (Detailed Flowchart)")
accent(s)

# 3-column flowchart: Doctor | System | Pharmacist/Patient
col_w=3.8; col_gap=0.55
c1x=0.22; c2x=4.57; c3x=8.92

# Column headers
for cx,lbl,fill in [(c1x,"\U0001f9d1\u200d\u2695\ufe0f  DOCTOR",TEAL),(c2x,"\u2699\ufe0f  SYSTEM (Backend)",NAVY),(c3x,"\U0001f48a  PHARMACIST / PATIENT",DTEAL)]:
    rect(s,cx,0.82,col_w,0.42,fill)
    tb(s,cx+0.05,0.82,col_w-0.1,0.42,lbl,11,bold=True,color=WHITE,align=PP_ALIGN.CENTER)

# Doctor column steps
d_steps=[
    ("Opens prescription form\nin Doctor Dashboard",1.38),
    ("Searches medicine DB\n(e.g. Metformin 500mg)",2.08),
    ("Sets dosage, frequency,\nduration, notes",2.78),
    ("Clicks SAVE\nPOST /api/prescriptions",3.48),
    ("Views patient's\nprescription history",5.28),
]
for txt,dy in d_steps:
    flow_box(s,c1x,dy,col_w,0.58,txt,fill=TEAL,sz=9)
    if dy<5.28:
        rect(s,c1x+col_w/2-0.012,dy+0.58,0.025,0.12,MGRAY)

# System column steps
sys_steps=[
    ("JWT verified\nRBAC: DOCTOR role only",1.38),
    ("Zod schema validation\n(required fields, types)",2.08),
    ("Saved to DB\n(prescriptions table)",2.78),
    ("Socket.io emit to\npharmacist namespace",3.48),
    ("Audit log created\n(user, IP, timestamp, data)",4.18),
    ("PDF generated\nvia Puppeteer on demand",5.28),
]
for txt,sy2 in sys_steps:
    flow_box(s,c2x,sy2,col_w,0.58,txt,fill=NAVY,sz=9)
    if sy2<5.28:
        rect(s,c2x+col_w/2-0.012,sy2+0.58,0.025,0.12,MGRAY)

# Pharmacist/Patient column
p_steps=[
    ("Pharmacist sees\nnew prescription badge",1.38),
    ("Reviews prescription\nin dispensing queue",2.08),
    ("Dispenses medication\nPATCH /api/prescriptions/:id/dispense",2.78),
    ("Patient notified\nvia Socket.io push",3.48),
    ("Patient downloads PDF\nGET /api/prescriptions/:id/pdf",5.28),
]
for txt,py2 in p_steps:
    flow_box(s,c3x,py2,col_w,0.58,txt,fill=DTEAL,sz=9)
    if py2<5.28:
        rect(s,c3x+col_w/2-0.012,py2+0.58,0.025,0.12,MGRAY)

# Cross arrows (Doctor -> System, System -> Pharmacist)
for ay in [1.67,2.37,3.07,3.77]:
    rect(s,c1x+col_w,ay,col_gap-0.02,0.025,YELLOW)
    rect(s,c2x+col_w,ay,col_gap-0.02,0.025,YELLOW)

# Bottom bar
rect(s,0.22,6.0,12.88,0.72,NAVY)
tb(s,0.3,6.02,12.7,0.68,
   "Every API call pipeline: Request ID \u2192 Helmet \u2192 CORS \u2192 Rate Limit \u2192 IP Check \u2192 CSRF \u2192 Sanitize \u2192 JWT Auth \u2192 RBAC \u2192 Zod Validate \u2192 Execute \u2192 Audit Log",
   10,color=TEAL,align=PP_ALIGN.CENTER,wrap=True)

notes(s,"This flowchart shows how three different roles interact through the system in real time. The doctor writes the prescription, the system validates and saves it, and the pharmacist is notified instantly via Socket.io. The patient is notified when the medication is dispensed. Every step creates an audit log entry. The PDF is generated on demand by Puppeteer.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 15 — USE CASES
# ════════════════════════════════════════════════════════════════════════════
print("Slide 15: Use Cases")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Real Use Cases — From Actual Code")
accent(s)

uc=[
    ("\U0001f9d1\u200d\u2695\ufe0f PATIENT PORTAL",
     "Patient logs in with MRN \u2192 sees medical timeline (all visits, vitals, prescriptions) \u2192 "
     "checks lab results \u2192 downloads prescription PDF \u2192 pays bill via Razorpay \u2192 books follow-up appointment",
     TEAL),
    ("\U0001f4f9 TELEMEDICINE SESSION",
     "Doctor creates video session \u2192 POST /api/telemedicine/sessions \u2192 Socket.io sends call invite to patient \u2192 "
     "WebRTC peer connection established \u2192 post-call: doctor creates medical record + prescription in system",
     DTEAL),
    ("\U0001f50d AUDIT INVESTIGATION",
     "Admin suspects unauthorized data access \u2192 opens Audit Log Viewer \u2192 filters by user 'nurse_sara' and date range \u2192 "
     "clicks 'Verify Chain' \u2192 GET /api/admin/audit-logs/verify returns {valid:true} \u2192 flags suspicious entry with reason",
     NAVY),
    ("\U0001f9b8 BLOOD BANK EMERGENCY",
     "Nurse needs O-negative blood urgently \u2192 opens Blood Bank module \u2192 filters by type O- \u2192 "
     "sees 3 units (1 expiring tomorrow) \u2192 requests unit \u2192 transfusion logged with patient ID, nurse ID, timestamp",
     RED),
    ("\U0001f4e6 INVENTORY QR SCAN",
     "Nurse picks up IV bag from storage \u2192 scans QR code with phone camera \u2192 "
     "POST /api/inventory/qr/scan \u2192 stock decremented by 1 \u2192 if stock < reorder level, email alert sent to inventory manager",
     RGBColor(0xD9,0x7F,0x06)),
    ("\U0001f512 FORCE LOGOUT",
     "IT Admin sees suspicious session from unknown IP in Session Manager \u2192 "
     "clicks Force Logout \u2192 DELETE /api/admin/sessions/:id \u2192 Redis session deleted \u2192 "
     "user's next request returns 401 Unauthorized instantly",
     RGBColor(0x7C,0x3A,0xED)),
]
uw=6.1; uh=1.72; ugap=0.18
for i,(title,body,fill) in enumerate(uc):
    col=i%2; row=i//2
    ux=0.22+col*(uw+ugap)
    uy=0.85+row*(uh+0.12)
    rect(s,ux,uy,uw,uh,fill)
    tb(s,ux+0.1,uy+0.06,uw-0.2,0.32,title,11,bold=True,color=WHITE,align=PP_ALIGN.LEFT)
    hline(s,ux+0.1,uy+0.38,uw-0.2,WHITE)
    tb(s,ux+0.1,uy+0.44,uw-0.2,uh-0.5,body,9,color=WHITE,align=PP_ALIGN.LEFT,wrap=True)

notes(s,"These are real workflows supported by actual code in the system. The patient portal gives patients full visibility into their own care. The audit log has hash-chain verification that mathematically proves no entry has been tampered with. The blood bank tracks every unit from arrival to transfusion. The force logout feature lets admins terminate any session in real time.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 16 — TECHNOLOGIES USED
# ════════════════════════════════════════════════════════════════════════════
print("Slide 16: Technologies")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Technology Stack — Auto-Detected from package.json")
accent(s)

tech=[
    ("React 18.2","18.2.0","UI framework, lazy-loaded routes, concurrent rendering","Frontend"),
    ("Vite + PWA","5.0 + 0.19","Build tool, service worker, offline support, installable","Frontend"),
    ("Zustand","5.0","Client state management with sessionStorage persistence","Frontend"),
    ("TanStack Query","5.17","Server state, caching, background refetch, optimistic updates","Frontend"),
    ("React Hook Form + Zod","7.72 + 4.3","Form handling and schema validation on client side","Frontend"),
    ("Recharts","3.8","Analytics charts: bar, line, pie for admin dashboards","Frontend"),
    ("Socket.io Client","4.8.3","Real-time WebSocket: chat, notifications, telemedicine","Frontend"),
    ("Framer Motion","12.38","Smooth UI animations and transitions","Frontend"),
    ("Node.js + Express","5.2.1","REST API server with async error handling","Backend"),
    ("PostgreSQL + pgcrypto","—","Relational DB with field-level AES encryption","Backend"),
    ("Redis + BullMQ","—","Sessions, rate limiting, refresh tokens, async job queues","Backend"),
    ("Argon2id","0.44","Password hashing — PHC winner, GPU-resistant","Backend"),
    ("Puppeteer","22.0","Headless Chrome for PDF generation (prescriptions, discharge)","Backend"),
    ("ClamScan","2.4","Antivirus scanning on every file upload","Backend"),
    ("Razorpay","2.9.6","Payment gateway for patient bill payments","Backend"),
    ("Helmet + CSRF-CSRF","8.0 + 4.0","Security headers + double-submit CSRF protection","Backend"),
]
# Table
from pptx.util import Inches as I, Pt as P
tbl=s.shapes.add_table(len(tech)+1,4,I(0.22),I(0.85),I(12.88),I(6.5)).table
hdrs=["Technology","Version","Purpose","Layer"]
hw=[3.2,1.2,6.8,1.68]
for ci,h in enumerate(hdrs):
    tbl.columns[ci].width=I(hw[ci])
    c=tbl.cell(0,ci); c.text=h
    c.fill.solid(); c.fill.fore_color.rgb=NAVY
    p=c.text_frame.paragraphs[0]; p.alignment=PP_ALIGN.CENTER
    r=p.runs[0]; r.font.bold=True; r.font.color.rgb=WHITE; r.font.size=P(11); r.font.name="Calibri"

for ri,(tech_n,ver,purpose,layer) in enumerate(tech):
    bg=LGRAY if ri%2==0 else WHITE
    lc=TEAL if layer=="Frontend" else DTEAL
    for ci,(val,al) in enumerate([(tech_n,PP_ALIGN.LEFT),(ver,PP_ALIGN.CENTER),(purpose,PP_ALIGN.LEFT),(layer,PP_ALIGN.CENTER)]):
        c=tbl.cell(ri+1,ci); c.text=val
        c.fill.solid(); c.fill.fore_color.rgb=bg
        p=c.text_frame.paragraphs[0]; p.alignment=al
        r=p.runs[0]; r.font.size=P(10); r.font.name="Calibri"
        r.font.color.rgb=lc if ci==0 else DARK
        if ci==0: r.font.bold=True

notes(s,"The technology choices reflect a modern, production-ready stack. Express 5 has improved async error handling. Argon2id won the Password Hashing Competition and is recommended over bcrypt. Puppeteer runs headless Chrome on the server to generate PDFs. ClamScan is an open-source antivirus integrated into the upload pipeline. Razorpay handles real payment processing.")


# ════════════════════════════════════════════════════════════════════════════
# SLIDE 17 — ADVANTAGES
# ════════════════════════════════════════════════════════════════════════════
print("Slide 17: Advantages")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Key Advantages — What Makes This System Stand Out")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.4,[
    "  \u2705  Truly Role-Based (19 Roles): Each role has a purpose-built dashboard; no role can access another's data",
    "       Example: A billing clerk cannot see prescriptions; a nurse cannot access financial reports",
    "  \u2705  Defense in Depth (9 Layers): Multiple security barriers \u2014 attacker must bypass all 9 layers to reach business logic",
    "       Example: Even with a stolen JWT, attacker still blocked by RBAC, rate limiting, and IP blocking",
    "  \u2705  Real-Time Everything: Socket.io powers live chat, notifications, telemedicine, and force-logout \u2014 zero polling",
    "       Example: Pharmacist sees new prescription badge appear in 50ms without refreshing the page",
    "  \u2705  Tamper-Evident Audit Trail: Hash-chain verification \u2014 mathematically impossible to delete a log without detection",
    "       Example: If row #500 is deleted, row #501's prev_hash won't match \u2014 chain verification fails immediately",
    "  \u2705  PWA + Offline Support: Works offline with service worker caching \u2014 critical for hospitals with poor connectivity",
    "       Example: Nurse records vitals offline \u2192 data syncs automatically when connection restored",
    "  \u2705  Automated Async Workflows: BullMQ job queues handle email, PDF, virus scan without blocking the main thread",
    "       Example: Discharge PDF generation takes 3 seconds \u2014 runs in background, user not blocked",
    "  \u2705  OpenFDA Integration: Medicine database can import drug data directly from US FDA's public API",
],sz=12,color=DARK,spacing=3)
notes(s,"The biggest advantage is that security and real-time capability are core to the architecture, not add-ons. The tamper-evident audit log is particularly unique — most hospital systems just store logs in a table. This system chains each entry with cryptographic hashes, so deletion or modification is immediately detectable.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 18 — LIMITATIONS
# ════════════════════════════════════════════════════════════════════════════
print("Slide 18: Limitations")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Current Limitations — Honest Assessment")
accent(s)
rect(s,0.2,0.82,12.9,6.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,6.4,[
    "  \u26a0\ufe0f  Telemedicine Video Provider: Socket.io handles signaling but actual video stream requires external provider (Twilio/Jitsi)",
    "       Impact: Video calls depend on third-party uptime and pricing; not fully self-hosted",
    "  \u26a0\ufe0f  Single Hospital Instance: Designed for one hospital \u2014 no multi-tenant or multi-branch architecture currently",
    "       Impact: A hospital chain with 5 branches would need 5 separate deployments",
    "  \u26a0\ufe0f  No CI/CD Pipeline: No automated deployment, testing pipeline, or Kubernetes configuration included",
    "       Impact: Deployment requires manual setup; no automated rollback on failure",
    "  \u26a0\ufe0f  Radiology Module Partial: Radiologist role exists in RBAC and frontend, but full report module is scaffolded only",
    "       Impact: Radiologists can log in but cannot upload/view radiology reports yet",
    "  \u26a0\ufe0f  Payment Geography: Razorpay supports Indian payment methods only \u2014 no Stripe or international gateway",
    "       Impact: International hospitals or patients with foreign cards cannot use online payment",
    "  \u26a0\ufe0f  iOS PWA Limitations: Push notifications limited on iOS Safari; install prompt not supported on all iOS versions",
    "       Impact: iPhone users may not receive real-time push notifications without opening the app",
    "  \u26a0\ufe0f  No Automated Tests: No unit/integration test suite included in the codebase currently",
],sz=12,color=DARK,spacing=3)
notes(s,"Being honest about limitations is important. The telemedicine feature works but relies on an external video provider. The system is designed for a single hospital — multi-branch support would require architectural changes. The radiology module has roles and permissions defined but the full UI is partially implemented.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 19 — FUTURE ENHANCEMENTS
# ════════════════════════════════════════════════════════════════════════════
print("Slide 19: Future Enhancements")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Future Enhancements — Roadmap")
accent(s)

enh=[
    ("\U0001f916 AI Diagnostics","ML models for vital sign anomaly detection, drug interaction warnings, readmission risk scoring",RGBColor(0x7C,0x3A,0xED)),
    ("\U0001f3e2 Multi-Tenant","Support multiple hospital branches with complete data isolation and centralized admin",NAVY),
    ("\U0001f517 HL7/FHIR","Standard healthcare data exchange for interoperability with other hospital systems and insurance",TEAL),
    ("\U0001f4f1 Native Mobile","React Native apps for iOS and Android with full offline sync and native push notifications",DTEAL),
    ("\U0001f4ca Predictive Analytics","Bed occupancy forecasting, revenue prediction, staff workload optimization using historical data",RGBColor(0xD9,0x7F,0x06)),
    ("\U0001f4b3 Insurance Automation","Automated insurance claim submission, pre-authorization, and reconciliation with providers",GREEN),
    ("\U0001f9ea Lab Equipment API","Direct integration with lab analyzers to auto-import results without manual entry",RGBColor(0xF9,0x73,0x16)),
    ("\U0001f6e1\ufe0f Zero-Trust Security","Implement zero-trust network access, mTLS between services, and hardware security keys (FIDO2)",RED),
]
ew=5.9; eh=1.35; egap=0.2
for i,(title,body,fill) in enumerate(enh):
    col=i%2; row=i//2
    ex=0.22+col*(ew+egap)
    ey=0.85+row*(eh+0.15)
    rect(s,ex,ey,ew,eh,fill)
    tb(s,ex+0.1,ey+0.06,ew-0.2,0.32,title,11,bold=True,color=WHITE,align=PP_ALIGN.LEFT)
    hline(s,ex+0.1,ey+0.38,ew-0.2,WHITE)
    tb(s,ex+0.1,ey+0.44,ew-0.2,eh-0.5,body,9,color=WHITE,align=PP_ALIGN.LEFT,wrap=True)

notes(s,"The foundation is solid enough to support significant enhancements. AI integration using the vitals data already being collected could detect early warning signs of patient deterioration. FHIR integration would allow data exchange with other hospital systems, increasingly required by healthcare regulations. Multi-tenant support would make this commercially viable as a SaaS product for hospital chains.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 20 — CONCLUSION
# ════════════════════════════════════════════════════════════════════════════
print("Slide 20: Conclusion")
s=prs.slides.add_slide(BLANK)
title_bar(s,"Conclusion — Summary")
accent(s)
rect(s,0.2,0.82,12.9,4.55,LGRAY)
bullets_centered(s,0.4,0.9,12.5,4.4,[
    "  \u2022  Built a production-grade HMS covering the complete hospital workflow from registration to discharge and billing",
    "  \u2022  Supports 19 user roles with strict RBAC across 30+ independent, modular backend services",
    "  \u2022  Implements enterprise-level security: Argon2id, RS256 JWT, pgcrypto field encryption, CSRF, ClamScan, hash-chain audit",
    "  \u2022  Enables real-time collaboration via Socket.io: live chat, instant notifications, telemedicine video calls",
    "  \u2022  Designed as a PWA for cross-device accessibility including offline support via service worker",
    "  \u2022  Integrates Razorpay for real payment processing, Puppeteer for PDF generation, BullMQ for async jobs",
    "  \u2022  Tamper-evident audit logs with hash-chain verification \u2014 a feature normally found in financial/legal systems",
    "  \u2022  Demonstrates how modern web technologies can solve real, complex healthcare challenges at scale",
],sz=13,color=DARK,spacing=4)

rect(s,0.22,5.48,12.88,1.82,NAVY)
tb(s,0.3,5.52,12.7,0.38,"\u201c This system doesn\u2019t just manage a hospital \u2014 it secures it, connects it, and makes it smarter. \u201d",
   14,italic=True,color=TEAL,align=PP_ALIGN.CENTER)
hline(s,1.5,5.95,10.33,TEAL)
# Stats row
stats=[("19","User Roles"),("30+","API Modules"),("40+","DB Tables"),("9","Security Layers"),("4","Socket.io Namespaces"),("3","PDF Types")]
sw=1.9; sgap=0.22; ssx=(13.33-(6*sw+5*sgap))/2
for i,(num,lbl) in enumerate(stats):
    sx2=ssx+i*(sw+sgap)
    tb(s,sx2,6.05,sw,0.52,num,22,bold=True,color=TEAL,align=PP_ALIGN.CENTER)
    tb(s,sx2,6.55,sw,0.38,lbl,9,color=WHITE,align=PP_ALIGN.CENTER)

notes(s,"To summarize: this system goes far beyond a typical project. It implements security patterns used in banking, real-time features used in communication platforms, and clinical workflows used in actual hospital software. Every feature shown today is backed by real, working code — not mockups or assumptions.")

# ════════════════════════════════════════════════════════════════════════════
# SLIDE 21 — THANK YOU
# ════════════════════════════════════════════════════════════════════════════
print("Slide 21: Thank You")
s=prs.slides.add_slide(BLANK)
navy_bg(s)
rect(s,0,3.5,13.33,4.0,DTEAL)
hline(s,0,3.45,13.33,TEAL)

tb(s,0.5,0.8,12.33,1.1,"Thank You",46,bold=True,color=WHITE,align=PP_ALIGN.CENTER)
tb(s,0.5,2.0,12.33,0.55,"Questions & Discussion Welcome",20,color=TEAL,align=PP_ALIGN.CENTER)
hline(s,1.5,2.7,10.33)

row1=[("19 User Roles",0.5),("30+ Modules",3.1),("40+ DB Tables",5.7),("9 Security Layers",8.3),("Real-time Chat",10.9)]
for txt,bx in row1:
    badge(s,bx,3.65,2.3,0.48,txt,10)
row2=[("Telemedicine",0.5),("PDF Generation",3.1),("Virus Scanning",5.7),("Hash-Chain Audit",8.3),("PWA + Offline",10.9)]
for txt,bx in row2:
    badge(s,bx,4.28,2.3,0.48,txt,10,fill=NAVY)

tb(s,0.5,5.0,12.33,0.45,"[Your Email]  |  [GitHub Repository Link]  |  [Institution Name]",12,color=WHITE,align=PP_ALIGN.CENTER)
tb(s,0.5,5.55,12.33,1.6,
   "Built with: React 18  \u2022  Node.js + Express 5  \u2022  PostgreSQL  \u2022  Redis  \u2022  Socket.io  \u2022  Argon2id  \u2022  Puppeteer  \u2022  ClamScan  \u2022  Razorpay",
   11,color=LBLUE,align=PP_ALIGN.CENTER)

notes(s,"Thank you for your attention. I am happy to answer any questions about the technical implementation, security architecture, or clinical workflows. If you would like a live demo of any specific feature, I can walk you through it.")

# ════════════════════════════════════════════════════════════════════════════
# SAVE
# ════════════════════════════════════════════════════════════════════════════
out="HMS_Presentation_v3.pptx"
prs.save(out)
print(f"\n✅  Saved: {out}  ({len(prs.slides)} slides)")
