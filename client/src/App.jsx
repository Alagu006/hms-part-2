import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStore } from './shared/store/index.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// ── Lazy-loaded pages ─────────────────────────────────────────────────────────
const Login = lazy(() => import('./modules/auth/Login.jsx'));
const ForcePasswordChange = lazy(() => import('./modules/auth/ForcePasswordChange.jsx'));

// Admin
const AdminDashboard  = lazy(() => import('./modules/admin/AdminDashboard.jsx'));
const UserManagement  = lazy(() => import('./modules/admin/UserManagement.jsx'));
const Analytics       = lazy(() => import('./modules/admin/Analytics.jsx'));
const AuditLogViewer  = lazy(() => import('./modules/admin/AuditLogViewer.jsx'));
const BroadcastCompose = lazy(() => import('./modules/admin/BroadcastCompose.jsx'));
const FinancialSummary = lazy(() => import('./modules/admin/FinancialSummary.jsx'));
const OTCalendar      = lazy(() => import('./modules/admin/OTCalendar.jsx'));
const Reports         = lazy(() => import('./modules/admin/Reports.jsx'));

// Doctor
const DoctorDashboard  = lazy(() => import('./modules/doctor/DoctorDashboard.jsx'));
const PrescriptionForm  = lazy(() => import('./modules/doctor/PrescriptionForm.jsx'));
const DischargeForm     = lazy(() => import('./modules/doctor/DischargeForm.jsx'));
const DischargeDocument = lazy(() => import('./modules/doctor/DischargeDocument.jsx'));

// Nurse
const NurseDashboard = lazy(() => import('./modules/nurse/NurseDashboard.jsx'));
const RecordVitals = lazy(() => import('./modules/nurse/RecordVitals.jsx'));

// Lab
const LabDashboard = lazy(() => import('./modules/lab/LabDashboard.jsx'));

// Patient
const PatientTimeline  = lazy(() => import('./modules/patient/PatientTimeline.jsx'));
const MyPrescriptions  = lazy(() => import('./modules/patient/MyPrescriptions.jsx'));
const MyBills          = lazy(() => import('./modules/patient/MyBills.jsx'));
const Chatbot          = lazy(() => import('./modules/patient/Chatbot.jsx'));
const BookAppointment  = lazy(() => import('./modules/patient/BookAppointment.jsx'));
const PatientAppointments = lazy(() => import('./modules/patient/PatientAppointments.jsx'));

// Receptionist
const AddPatientForm = lazy(() => import('./modules/receptionist/AddPatientForm.jsx'));
const PatientList    = lazy(() => import('./modules/receptionist/PatientList.jsx'));

// Inventory
const InventoryDashboard = lazy(() => import('./modules/inventory/InventoryDashboard.jsx'));
const BedMatrix          = lazy(() => import('./modules/inventory/BedMatrix.jsx'));
const BloodBank          = lazy(() => import('./modules/inventory/BloodBank.jsx'));
const GenerateQR         = lazy(() => import('./modules/inventory/GenerateQR.jsx'));
const QRScanner          = lazy(() => import('./modules/inventory/QRScanner.jsx'));

// Billing
const GenerateBill = lazy(() => import('./modules/billing/GenerateBill.jsx'));

// Messaging (all non-patient staff)
const MessagingLayout = lazy(() => import('./modules/messaging/MessagingLayout.jsx'));

// Telemedicine
const TeleRoom        = lazy(() => import('./modules/telemedicine/TeleRoom.jsx'));
const UpcomingSession = lazy(() => import('./modules/telemedicine/UpcomingSession.jsx'));

// Leaves
const ApplyLeave = lazy(() => import('./modules/leaves/ApplyLeave.jsx'));

// Shared
const IncidentReport = lazy(() => import('./modules/shared/IncidentReport.jsx'));

// ---------------------------------------------------------------------------
// Role-based redirect from /
// ---------------------------------------------------------------------------
const ROLE_HOME = {
  SUPER_ADMIN : '/admin',
  ADMIN       : '/admin',
  DOCTOR      : '/doctor',
  NURSE       : '/nurse',
  RECEPTIONIST: '/receptionist/patients',
  LAB_TECH    : '/lab',
  PHARMACIST  : '/pharmacy/prescriptions',
  INVENTORY   : '/inventory',
  BILLING     : '/billing',
  PATIENT     : '/patient/timeline',
};

function RoleRedirect() {
  const user = useStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  const primaryRole = user.roles?.[0];
  return <Navigate to={ROLE_HOME[primaryRole] ?? '/login'} replace />;
}

// ---------------------------------------------------------------------------
// Route guards
// ---------------------------------------------------------------------------
function RequireAuth({ allowedRoles }) {
  const user = useStore((s) => s.user);

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.some((r) => user.roles?.includes(r))) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div style={{ padding: '2rem' }}>Loading…</div>}>
          <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/first-login" element={<ForcePasswordChange />} />

          {/* Root — redirect by role */}
          <Route path="/" element={<RoleRedirect />} />

          {/* ── PATIENT ──────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['PATIENT']} />}>
            <Route path="/patient/timeline"       element={<PatientTimeline />} />
            <Route path="/patient/prescriptions" element={<MyPrescriptions />} />
            <Route path="/patient/bills"         element={<MyBills />} />
            <Route path="/patient/chatbot"       element={<Chatbot />} />
            <Route path="/patient/telemedicine"  element={<UpcomingSession />} />
            <Route path="/patient/appointments"  element={<PatientAppointments />} />
            <Route path="/patient/appointments/book" element={<BookAppointment />} />
          </Route>

          {/* ── DOCTOR ───────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['DOCTOR']} />}>
            <Route path="/doctor"                    element={<DoctorDashboard />} />
            <Route path="/doctor/prescriptions"       element={<PrescriptionForm />} />
            <Route path="/doctor/discharge"           element={<DischargeForm />} />
            <Route path="/doctor/discharge/:id"       element={<DischargeDocument />} />
            <Route path="/doctor/telemedicine"        element={<UpcomingSession />} />
            <Route path="/doctor/telemedicine/:roomId" element={<TeleRoom />} />
            <Route path="/doctor/leaves"              element={<ApplyLeave />} />
            <Route path="/doctor/incidents"           element={<IncidentReport />} />
          </Route>

          {/* ── NURSE ────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['NURSE']} />}>
            <Route path="/nurse"          element={<NurseDashboard />} />
            <Route path="/nurse/vitals"   element={<RecordVitals />} />
            <Route path="/nurse/leaves"    element={<ApplyLeave />} />
            <Route path="/nurse/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── RECEPTIONIST ─────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['RECEPTIONIST']} />}>
            <Route path="/receptionist/patients"     element={<PatientList />} />
            <Route path="/receptionist/patients/new" element={<AddPatientForm />} />
            <Route path="/receptionist/leaves"       element={<ApplyLeave />} />
          </Route>

          {/* ── LAB_TECH ─────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['LAB_TECH']} />}>
            <Route path="/lab"           element={<LabDashboard />} />
            <Route path="/lab/blood-bank" element={<BloodBank />} />
            <Route path="/lab/leaves"     element={<ApplyLeave />} />
            <Route path="/lab/incidents"  element={<IncidentReport />} />
          </Route>

          {/* ── PHARMACIST ───────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['PHARMACIST']} />}>
            <Route path="/pharmacy/prescriptions" element={<PrescriptionForm />} />
            <Route path="/pharmacy/leaves"        element={<ApplyLeave />} />
          </Route>

          {/* ── INVENTORY ────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['INVENTORY', 'ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/inventory"          element={<InventoryDashboard />} />
            <Route path="/inventory/beds"     element={<BedMatrix />} />
            <Route path="/inventory/blood"    element={<BloodBank />} />
            <Route path="/inventory/qr/gen"   element={<GenerateQR />} />
            <Route path="/inventory/qr/scan"  element={<QRScanner />} />
          </Route>

          {/* ── BILLING ──────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/billing" element={<GenerateBill />} />
          </Route>

          {/* ── ADMIN / SUPER_ADMIN ───────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/admin"            element={<AdminDashboard />} />
            <Route path="/admin/users"      element={<UserManagement />} />
            <Route path="/admin/analytics"  element={<Analytics />} />
            <Route path="/admin/audit"      element={<AuditLogViewer />} />
            <Route path="/admin/broadcast"  element={<BroadcastCompose />} />
            <Route path="/admin/financial"  element={<FinancialSummary />} />
            <Route path="/admin/ot"         element={<OTCalendar />} />
            <Route path="/admin/reports"    element={<Reports />} />
            <Route path="/admin/leaves"     element={<ApplyLeave />} />
          </Route>

          {/* ── MESSAGING — all non-patient staff ────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={[
            'SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST',
            'LAB_TECH','PHARMACIST','INVENTORY','BILLING','HR',
            'IT_ADMIN','RADIOLOGIST','ANESTHETIST','DIETITIAN',
            'PHYSIO','SOCIAL_WORKER','SECURITY_OFC','ORDERLY',
          ]} />}>
            <Route path="/messaging" element={<MessagingLayout />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
