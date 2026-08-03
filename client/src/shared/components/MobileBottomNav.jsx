import { NavLink } from 'react-router-dom';
import { useStore } from '../store/index.js';
import styles from './MobileBottomNav.module.scss';

// Role → 4 most important nav items for bottom bar
const BOTTOM_NAV = {
  SUPER_ADMIN : [
    { label: 'Dashboard', to: '/admin',           icon: '🏠' },
    { label: 'Users',     to: '/admin/users',      icon: '👥' },
    { label: 'Analytics', to: '/admin/analytics',  icon: '📊' },
    { label: 'Messages',  to: '/messaging',         icon: '💬' },
  ],
  ADMIN: [
    { label: 'Dashboard', to: '/admin',           icon: '🏠' },
    { label: 'Users',     to: '/admin/users',      icon: '👥' },
    { label: 'Analytics', to: '/admin/analytics',  icon: '📊' },
    { label: 'Messages',  to: '/messaging',         icon: '💬' },
  ],
  DOCTOR: [
    { label: 'Dashboard',  to: '/doctor',                 icon: '🏠' },
    { label: 'Rx',         to: '/doctor/prescriptions',   icon: '💊' },
    { label: 'Vitals',     to: '/doctor/patient-vitals',  icon: '📊' },
    { label: 'History',    to: '/doctor/patient-history', icon: '📋' },
    { label: 'Messages',   to: '/messaging',              icon: '💬' },
  ],
  NURSE: [
    { label: 'Dashboard', to: '/nurse',          icon: '🏠' },
    { label: 'Vitals',    to: '/nurse/vitals',   icon: '📊' },
    { label: 'Handover',  to: '/nurse/handover', icon: '📋' },
    { label: 'Messages',  to: '/messaging',       icon: '💬' },
  ],
  RECEPTIONIST: [
    { label: 'Dashboard', to: '/receptionist',              icon: '🏠' },
    { label: 'Patients',  to: '/receptionist/patients',     icon: '👥' },
    { label: 'Add',       to: '/receptionist/patients/new', icon: '➕' },
    { label: 'Messages',  to: '/messaging',                  icon: '💬' },
  ],
  LAB_TECH: [
    { label: 'Dashboard', to: '/lab',            icon: '🏠' },
    { label: 'Blood',     to: '/lab/blood-bank', icon: '🩸' },
    { label: 'Messages',  to: '/messaging',       icon: '💬' },
    { label: 'Profile',   to: '/profile',         icon: '👤' },
  ],
  PHARMACIST: [
    { label: 'Dashboard', to: '/pharmacy',  icon: '🏠' },
    { label: 'Messages',  to: '/messaging', icon: '💬' },
    { label: 'Profile',   to: '/profile',   icon: '👤' },
    { label: 'Leave',     to: '/pharmacy/leaves', icon: '📅' },
  ],
  INVENTORY: [
    { label: 'Dashboard', to: '/inventory',       icon: '🏠' },
    { label: 'Beds',      to: '/inventory/beds',  icon: '🛏️' },
    { label: 'Blood',     to: '/inventory/blood', icon: '🩸' },
    { label: 'Messages',  to: '/messaging',        icon: '💬' },
  ],
  PATIENT: [
    { label: 'Timeline',  to: '/patient/timeline',      icon: '🏠' },
    { label: 'Appts',     to: '/patient/appointments',  icon: '📅' },
    { label: 'Vitals',    to: '/patient/vitals',         icon: '📊' },
    { label: 'Chatbot',   to: '/patient/chatbot',        icon: '🤖' },
  ],
  HR: [
    { label: 'Dashboard', to: '/hr',         icon: '🏠' },
    { label: 'Staff',     to: '/hr/staff',   icon: '👥' },
    { label: 'Shifts',    to: '/hr/shifts',  icon: '🕐' },
    { label: 'Messages',  to: '/messaging',   icon: '💬' },
  ],
};

const FALLBACK = [
  { label: 'Home',     to: '/',          icon: '🏠' },
  { label: 'Messages', to: '/messaging', icon: '💬' },
  { label: 'Profile',  to: '/profile',   icon: '👤' },
];

export default function MobileBottomNav() {
  const { user } = useStore();
  const primaryRole = user?.roles?.[0];
  const items = BOTTOM_NAV[primaryRole] ?? FALLBACK;

  return (
    <nav className={styles.nav} aria-label="Mobile navigation">
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/admin' || item.to === '/doctor' || item.to === '/nurse'}
          className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
          aria-label={item.label}
        >
          <span className={styles.icon} aria-hidden="true">{item.icon}</span>
          <span className={styles.label}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
