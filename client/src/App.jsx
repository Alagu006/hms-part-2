import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStore } from './shared/store/index.js';
import SkeletonLoader from './shared/components/SkeletonLoader.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,          // 1 min — reduces refetches on mobile
      gcTime: 5 * 60_000,         // 5 min cache retention
      refetchOnWindowFocus: false, // avoid surprise refetches on tab switch
      refetchOnReconnect: true,    // but do refetch when network comes back
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
const HRDashboard     = lazy(() => import('./modules/admin/HRDashboard.jsx'));

// Doctor
const DoctorDashboard  = lazy(() => import('./modules/doctor/DoctorDashboard.jsx'));
const PrescriptionForm  = lazy(() => import('./modules/doctor/PrescriptionForm.jsx'));
const DischargeForm     = lazy(() => import('./modules/doctor/DischargeForm.jsx'));
const DischargeDocument = lazy(() => import('./modules/doctor/DischargeDocument.jsx'));
const PatientVitalsView = lazy(() => import('./modules/doctor/PatientVitalsView.jsx'));

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
const MyVitals = lazy(() => import('./modules/patient/MyVitals.jsx'));
const MyLabResults = lazy(() => import('./modules/patient/MyLabResults.jsx'));

// Receptionist
const AddPatientForm = lazy(() => import('./modules/receptionist/AddPatientForm.jsx'));
const PatientList    = lazy(() => import('./modules/receptionist/PatientList.jsx'));
const ReceptionistDashboard = lazy(() => import('./modules/receptionist/ReceptionistDashboard.jsx'));

// Pharmacy
const PharmacistDashboard = lazy(() => import('./modules/pharmacy/PharmacistDashboard.jsx'));

// Security
const SecurityDashboard = lazy(() => import('./modules/security/SecurityDashboard.jsx'));

// Inventory
const InventoryDashboard = lazy(() => import('./modules/inventory/InventoryDashboard.jsx'));
const InventoryManagerDashboard = lazy(() => import('./modules/inventory/InventoryManagerDashboard.jsx'));
const BedMatrix          = lazy(() => import('./modules/inventory/BedMatrix.jsx'));
const BloodBank          = lazy(() => import('./modules/inventory/BloodBank.jsx'));
const GenerateQR         = lazy(() => import('./modules/inventory/GenerateQR.jsx'));
const QRScanner          = lazy(() => import('./modules/inventory/QRScanner.jsx'));

// Billing
const GenerateBill = lazy(() => import('./modules/billing/GenerateBill.jsx'));

// HR (dedicated dashboard)
const HRManagerDashboard = lazy(() => import('./modules/hr/HRManagerDashboard.jsx'));

// IT Admin
const ITAdminDashboard = lazy(() => import('./modules/it/ITAdminDashboard.jsx'));

// Social Worker
const SocialWorkerDashboard = lazy(() => import('./modules/social-worker/SocialWorkerDashboard.jsx'));

// Orderly
const OrderlyDashboard = lazy(() => import('./modules/orderly/OrderlyDashboard.jsx'));

// Dietitian
const DietitianDashboard = lazy(() => import('./modules/dietitian/DietitianDashboard.jsx'));

// Physio
const PhysioDashboard = lazy(() => import('./modules/physio/PhysioDashboard.jsx'));

// Radiologist
const RadiologistDashboard = lazy(() => import('./modules/radiology/RadiologistDashboard.jsx'));

// Anesthetist
const AnesthetistDashboard = lazy(() => import('./modules/anesthetist/AnesthetistDashboard.jsx'));

// Messaging (all non-patient staff)
const MessagingLayout = lazy(() => import('./modules/messaging/MessagingLayout.jsx'));

// Telemedicine
const TeleRoom        = lazy(() => import('./modules/telemedicine/TeleRoom.jsx'));
const UpcomingSession = lazy(() => import('./modules/telemedicine/UpcomingSession.jsx'));

// Leaves
const ApplyLeave = lazy(() => import('./modules/leaves/ApplyLeave.jsx'));

// Handover Notes
const HandoverNotes = lazy(() => import('./modules/nurse/HandoverNotes.jsx'));

// Shifts Management
const ShiftsManagement = lazy(() => import('./modules/hr/ShiftsManagement.jsx'));

// Departments Management
const DepartmentsManagement = lazy(() => import('./modules/admin/DepartmentsManagement.jsx'));

// Shared
const IncidentReport = lazy(() => import('./modules/shared/IncidentReport.jsx'));
const UserProfile    = lazy(() => import('./modules/shared/UserProfile.jsx'));
const BroadcastsInbox = lazy(() => import('./modules/shared/BroadcastsInbox.jsx'));
import InstallPrompt from './shared/components/InstallPrompt.jsx';
import AppLayout from './shared/components/AppLayout.jsx';

// ── Public (pre-login) pages ──────────────────────────────────────────────────
const PublicLayout  = lazy(() => import('./modules/public/PublicLayout.jsx'));
const HomePage      = lazy(() => import('./modules/public/HomePage.jsx'));
const AboutPage     = lazy(() => import('./modules/public/AboutPage.jsx'));
const ContactPage   = lazy(() => import('./modules/public/ContactPage.jsx'));

// ---------------------------------------------------------------------------
// Role-based redirect from /
// ---------------------------------------------------------------------------
const ROLE_HOME = {
  SUPER_ADMIN  : '/admin',
  ADMIN        : '/admin',
  DOCTOR       : '/doctor',
  NURSE        : '/nurse',
  RECEPTIONIST : '/receptionist',
  LAB_TECH     : '/lab',
  PHARMACIST   : '/pharmacy',
  INVENTORY    : '/inventory',
  BILLING      : '/billing',
  SECURITY_OFC : '/security',
  PATIENT      : '/patient/timeline',
  HR           : '/hr',
  IT_ADMIN     : '/it',
  SOCIAL_WORKER: '/social-worker',
  ORDERLY      : '/orderly',
  DIETITIAN    : '/dietitian',
  PHYSIO       : '/physio',
  RADIOLOGIST  : '/radiology',
  ANESTHETIST  : '/anesthesia',
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
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{v7_startTransition: true,v7_relativeSplatPath: true}}>
        <Suspense fallback={<SkeletonLoader variant="page" />}>
          <Routes>
          {/* ── Public (pre-login) pages ─────────────────────────────────── */}
          <Route element={<PublicLayout />}>
            <Route path="/"        element={<HomePage />} />
            <Route path="/about"   element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
          </Route>

          {/* Auth pages (no layout wrapper) */}
          <Route path="/login"       element={<Login />} />
          <Route path="/first-login" element={<ForcePasswordChange />} />

          {/* Authenticated root — redirect by role */}
          <Route path="/dashboard" element={<RoleRedirect />} />

          {/* ── All protected routes share the AppLayout (sidebar) ── */}
          <Route element={<AppLayout />}>

          {/* ── PATIENT ──────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['PATIENT']} />}>
            <Route path="/patient/timeline"       element={<PatientTimeline />} />
            <Route path="/patient/prescriptions" element={<MyPrescriptions />} />
            <Route path="/patient/bills"         element={<MyBills />} />
            <Route path="/patient/chatbot"       element={<Chatbot />} />
            <Route path="/patient/telemedicine"  element={<UpcomingSession />} />
            <Route path="/patient/telemedicine/:roomId" element={<TeleRoom />} />
            <Route path="/patient/appointments"  element={<PatientAppointments />} />
            <Route path="/patient/appointments/book" element={<BookAppointment />} />
            <Route path="/patient/vitals"            element={<MyVitals />} />
            <Route path="/patient/lab-results"       element={<MyLabResults />} />
          </Route>

          {/* ── DOCTOR ───────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['DOCTOR']} />}>
            <Route path="/doctor"                    element={<DoctorDashboard />} />
            <Route path="/doctor/prescriptions"       element={<PrescriptionForm />} />
            <Route path="/doctor/discharge"           element={<DischargeForm />} />
            <Route path="/doctor/discharge/:id"       element={<DischargeDocument />} />
            <Route path="/doctor/telemedicine"        element={<UpcomingSession />} />
            <Route path="/doctor/telemedicine/:roomId" element={<TeleRoom />} />
            <Route path="/doctor/patient-vitals"      element={<PatientVitalsView />} />
            <Route path="/doctor/leaves"              element={<ApplyLeave />} />
            <Route path="/doctor/incidents"           element={<IncidentReport />} />
          </Route>

          {/* ── NURSE ────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['NURSE']} />}>
            <Route path="/nurse"             element={<NurseDashboard />} />
            <Route path="/nurse/vitals"      element={<RecordVitals />} />
            <Route path="/nurse/handover"    element={<HandoverNotes />} />
            <Route path="/nurse/leaves"      element={<ApplyLeave />} />
            <Route path="/nurse/incidents"   element={<IncidentReport />} />
          </Route>

          {/* ── RECEPTIONIST ─────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['RECEPTIONIST']} />}>
            <Route path="/receptionist"                    element={<ReceptionistDashboard />} />
            <Route path="/receptionist/patients"          element={<PatientList />} />
            <Route path="/receptionist/patients/new"       element={<AddPatientForm />} />
            <Route path="/receptionist/leaves"             element={<ApplyLeave />} />
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
            <Route path="/pharmacy"                        element={<PharmacistDashboard />} />
            <Route path="/pharmacy/leaves"                 element={<ApplyLeave />} />
          </Route>

          {/* ── INVENTORY ────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['INVENTORY', 'ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/inventory"          element={<InventoryManagerDashboard />} />
            <Route path="/inventory/items"   element={<InventoryDashboard />} />
            <Route path="/inventory/beds"     element={<BedMatrix />} />
            <Route path="/inventory/blood"    element={<BloodBank />} />
            <Route path="/inventory/qr/gen"   element={<GenerateQR />} />
            <Route path="/inventory/qr/scan"  element={<QRScanner />} />
          </Route>

          {/* ── SECURITY ─────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['SECURITY_OFC', 'ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/security" element={<SecurityDashboard />} />
          </Route>

          {/* ── BILLING ──────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/billing" element={<GenerateBill />} />
          </Route>

          {/* ── ADMIN / SUPER_ADMIN / HR ────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['ADMIN', 'SUPER_ADMIN', 'HR']} />}>
            <Route path="/admin"            element={<AdminDashboard />} />
            <Route path="/admin/users"      element={<UserManagement />} />
            <Route path="/admin/analytics"  element={<Analytics />} />
            <Route path="/admin/audit"      element={<AuditLogViewer />} />
            <Route path="/admin/broadcast"  element={<BroadcastCompose />} />
            <Route path="/admin/financial"  element={<FinancialSummary />} />
            <Route path="/admin/reports"    element={<Reports />} />
            <Route path="/admin/hr"         element={<HRDashboard />} />
            <Route path="/admin/departments" element={<DepartmentsManagement />} />
            <Route path="/admin/shifts"     element={<ShiftsManagement />} />
            <Route path="/admin/leaves"     element={<ApplyLeave />} />
          </Route>

          {/* ── OT CALENDAR — all clinical + admin roles ─────────────────────── */}
          <Route element={<RequireAuth allowedRoles={[
            'ADMIN', 'SUPER_ADMIN', 'HR',
            'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ANESTHETIST',
          ]} />}>
            <Route path="/admin/ot" element={<OTCalendar />} />
          </Route>

          {/* ── HR ───────────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['HR']} />}>
            <Route path="/hr"           element={<HRManagerDashboard />} />
            <Route path="/hr/staff"     element={<UserManagement />} />
            <Route path="/hr/shifts"    element={<ShiftsManagement />} />
            <Route path="/hr/leaves"    element={<ApplyLeave />} />
            <Route path="/hr/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── IT_ADMIN ─────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['IT_ADMIN', 'ADMIN', 'SUPER_ADMIN']} />}>
            <Route path="/it"       element={<ITAdminDashboard />} />
            <Route path="/it/audit" element={<ITAdminDashboard />} />
          </Route>

          {/* ── SOCIAL_WORKER ────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['SOCIAL_WORKER']} />}>
            <Route path="/social-worker"           element={<SocialWorkerDashboard />} />
            <Route path="/social-worker/leaves"    element={<ApplyLeave />} />
            <Route path="/social-worker/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── ORDERLY ──────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['ORDERLY']} />}>
            <Route path="/orderly"           element={<OrderlyDashboard />} />
            <Route path="/orderly/leaves"    element={<ApplyLeave />} />
            <Route path="/orderly/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── DIETITIAN ────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['DIETITIAN']} />}>
            <Route path="/dietitian"           element={<DietitianDashboard />} />
            <Route path="/dietitian/leaves"    element={<ApplyLeave />} />
            <Route path="/dietitian/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── PHYSIO ───────────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['PHYSIO']} />}>
            <Route path="/physio"           element={<PhysioDashboard />} />
            <Route path="/physio/leaves"    element={<ApplyLeave />} />
            <Route path="/physio/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── RADIOLOGIST ──────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['RADIOLOGIST']} />}>
            <Route path="/radiology"           element={<RadiologistDashboard />} />
            <Route path="/radiology/leaves"    element={<ApplyLeave />} />
            <Route path="/radiology/incidents" element={<IncidentReport />} />
          </Route>

          {/* ── ANESTHETIST ──────────────────────────────────────────────────── */}
          <Route element={<RequireAuth allowedRoles={['ANESTHETIST']} />}>
            <Route path="/anesthesia"           element={<AnesthetistDashboard />} />
            <Route path="/anesthesia/leaves"    element={<ApplyLeave />} />
            <Route path="/anesthesia/incidents" element={<IncidentReport />} />
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

          {/* ── PROFILE — all authenticated users ───────────────────────── */}
          <Route element={<RequireAuth allowedRoles={[
            'SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST','PATIENT',
            'LAB_TECH','PHARMACIST','INVENTORY','BILLING','HR',
            'IT_ADMIN','RADIOLOGIST','ANESTHETIST','DIETITIAN',
            'PHYSIO','SOCIAL_WORKER','SECURITY_OFC','ORDERLY',
          ]} />}>
            <Route path="/profile" element={<UserProfile />} />
            <Route path="/broadcasts" element={<BroadcastsInbox />} />
          </Route>

          </Route>{/* end AppLayout */}

          {/* Catch-all → public home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      <InstallPrompt />
    </QueryClientProvider>
  );
}
