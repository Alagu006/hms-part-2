import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/index.js';
import { useDarkMode } from '../hooks/useDarkMode.js';
import NotificationBell from '../../modules/notifications/NotificationBell.jsx';
import styles from './Navbar.module.scss';

// Role → friendly display name
const ROLE_LABELS = {
  SUPER_ADMIN  : 'Super Admin',
  ADMIN        : 'Admin',
  DOCTOR       : 'Doctor',
  NURSE        : 'Nurse',
  RECEPTIONIST : 'Receptionist',
  LAB_TECH     : 'Lab Technician',
  PHARMACIST   : 'Pharmacist',
  INVENTORY    : 'Inventory Manager',
  BILLING      : 'Billing',
  SECURITY_OFC : 'Security Officer',
  PATIENT      : 'Patient',
  HR           : 'HR Manager',
  IT_ADMIN     : 'IT Admin',
  SOCIAL_WORKER: 'Social Worker',
  ORDERLY      : 'Orderly',
  DIETITIAN    : 'Dietitian',
  PHYSIO       : 'Physiotherapist',
  RADIOLOGIST  : 'Radiologist',
  ANESTHETIST  : 'Anesthetist',
};

// Route segment → page title
const PAGE_TITLES = {
  '/admin'                    : 'Admin Dashboard',
  '/admin/users'              : 'User Management',
  '/admin/analytics'          : 'Analytics',
  '/admin/audit'              : 'Audit Log',
  '/admin/broadcast'          : 'Broadcast',
  '/admin/financial'          : 'Financial Summary',
  '/admin/ot'                 : 'OT Calendar',
  '/admin/reports'            : 'Reports',
  '/admin/hr'                 : 'HR Dashboard',
  '/admin/departments'        : 'Departments',
  '/admin/shifts'             : 'Shifts',
  '/admin/leaves'             : 'Apply Leave',
  '/doctor'                   : 'Doctor Dashboard',
  '/doctor/prescriptions'     : 'Prescriptions',
  '/doctor/discharge'         : 'Discharge',
  '/doctor/telemedicine'      : 'Telemedicine',
  '/doctor/patient-vitals'    : 'Patient Vitals',
  '/doctor/patient-history'   : 'Patient History',
  '/doctor/leaves'            : 'Apply Leave',
  '/doctor/incidents'         : 'Incident Report',
  '/nurse'                    : 'Nurse Dashboard',
  '/nurse/vitals'             : 'Record Vitals',
  '/nurse/handover'           : 'Handover Notes',
  '/nurse/leaves'             : 'Apply Leave',
  '/nurse/incidents'          : 'Incident Report',
  '/receptionist'             : 'Receptionist Dashboard',
  '/receptionist/patients'    : 'Patient List',
  '/receptionist/patients/new': 'Add Patient',
  '/receptionist/leaves'      : 'Apply Leave',
  '/lab'                      : 'Lab Dashboard',
  '/lab/blood-bank'           : 'Blood Bank',
  '/lab/leaves'               : 'Apply Leave',
  '/lab/incidents'            : 'Incident Report',
  '/pharmacy'                 : 'Pharmacist Dashboard',
  '/pharmacy/leaves'          : 'Apply Leave',
  '/inventory'                : 'Inventory Dashboard',
  '/inventory/items'          : 'Inventory Items',
  '/inventory/beds'           : 'Bed Matrix',
  '/inventory/blood'          : 'Blood Bank',
  '/inventory/qr/gen'         : 'Generate QR',
  '/inventory/qr/scan'        : 'Scan QR',
  '/billing'                  : 'Generate Bill',
  '/security'                 : 'Security Dashboard',
  '/hr'                       : 'HR Dashboard',
  '/hr/staff'                 : 'Manage Staff',
  '/hr/shifts'                : 'Shifts',
  '/hr/leaves'                : 'Leave Requests',
  '/hr/incidents'             : 'Incident Report',
  '/it'                       : 'IT Admin Dashboard',
  '/social-worker'            : 'Social Worker Dashboard',
  '/social-worker/leaves'     : 'Apply Leave',
  '/social-worker/incidents'  : 'Incident Report',
  '/orderly'                  : 'Orderly Dashboard',
  '/orderly/leaves'           : 'Apply Leave',
  '/orderly/incidents'        : 'Incident Report',
  '/dietitian'                : 'Dietitian Dashboard',
  '/dietitian/leaves'         : 'Apply Leave',
  '/dietitian/incidents'      : 'Incident Report',
  '/physio'                   : 'Physio Dashboard',
  '/physio/leaves'            : 'Apply Leave',
  '/physio/incidents'         : 'Incident Report',
  '/radiology'                : 'Radiologist Dashboard',
  '/radiology/leaves'         : 'Apply Leave',
  '/radiology/incidents'      : 'Incident Report',
  '/anesthesia'               : 'Anesthetist Dashboard',
  '/anesthesia/leaves'        : 'Apply Leave',
  '/anesthesia/incidents'     : 'Incident Report',
  '/patient/timeline'         : 'My Timeline',
  '/patient/appointments'     : 'Appointments',
  '/patient/appointments/book': 'Book Appointment',
  '/patient/vitals'           : 'My Vitals',
  '/patient/prescriptions'    : 'My Prescriptions',
  '/patient/lab-results'      : 'Lab Results',
  '/patient/bills'            : 'My Bills',
  '/patient/telemedicine'     : 'Telemedicine',
  '/patient/chatbot'          : 'AI Chatbot',
  '/messaging'                : 'Messaging',
  '/profile'                  : 'My Profile',
  '/broadcasts'               : 'Broadcasts',
};

function getPageTitle(pathname) {
  // Exact match first
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // Partial match for dynamic segments (e.g. /doctor/discharge/123)
  const match = Object.keys(PAGE_TITLES)
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_TITLES[match] : 'Dashboard';
}

export default function Navbar({ onOpenSearch }) {
  const { user, clearAuth } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { cycle: cycleTheme, theme } = useDarkMode();

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const primaryRole = user?.roles?.[0];
  const roleLabel   = ROLE_LABELS[primaryRole] ?? primaryRole?.replace(/_/g, ' ') ?? '';
  const pageTitle   = getPageTitle(pathname);
  const initials    = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`;

  return (
    <header className={styles.navbar} role="banner">
      {/* Left — page title */}
      <div className={styles.left}>
        <h1 className={styles.pageTitle}>{pageTitle}</h1>
        {roleLabel && <span className={styles.roleChip}>{roleLabel}</span>}
      </div>

      {/* Right — actions */}
      <div className={styles.right}>
        {/* Search shortcut */}
        {onOpenSearch && (
          <button
            className={styles.iconBtn}
            onClick={onOpenSearch}
            aria-label="Open search (press /)"
            title="Search  /"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
        )}

        {/* Theme toggle */}
        <button
          className={styles.iconBtn}
          onClick={cycleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : theme === 'high-contrast' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : theme === 'high-contrast' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            /* Sun icon — shown in dark mode */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : theme === 'high-contrast' ? (
            /* Contrast icon */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
            </svg>
          ) : (
            /* Moon icon — shown in light mode */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Notification bell */}
        {user && <NotificationBell currentUser={user} />}

        {/* Avatar → profile */}
        <button
          className={styles.avatarBtn}
          onClick={() => navigate('/profile')}
          aria-label="Go to my profile"
          title={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`}
        >
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
          <span className={styles.avatarName}>
            {user?.firstName} {user?.lastName}
          </span>
        </button>

        {/* Logout */}
        <button
          className={styles.logoutBtn}
          onClick={handleLogout}
          aria-label="Log out"
          title="Log out"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className={styles.logoutLabel}>Logout</span>
        </button>
      </div>
    </header>
  );
}
