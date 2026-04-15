import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store/index.js';
import { apiFetch } from '../utils/authHeaders.js';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { clearSessionKey } from '../utils/sessionKey.js';
import styles from './Sidebar.module.scss';

// ── Icons (inline SVG) ────────────────────────────────────────────────────────
const Icon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICONS = {
  dashboard   : 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  users       : 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  analytics   : 'M18 20V10M12 20V4M6 20v-6',
  audit       : 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  broadcast   : 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.07-1.07a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z',
  financial   : 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  ot          : 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  reports     : 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  hr          : 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  patient     : 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  appointment : 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  prescription: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 12v4M10 14h4',
  discharge   : 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z',
  vitals      : 'M22 12h-4l-3 9L9 3l-3 9H2',
  lab         : 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
  pharmacy    : 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
  inventory   : 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  bed         : 'M2 20v-8a2 2 0 012-2h16a2 2 0 012 2v8M2 20h20M6 10V4a1 1 0 011-1h10a1 1 0 011 1v6',
  blood       : 'M12 2.69l5.66 5.66a8 8 0 11-11.31 0z',
  qr          : 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z',
  billing     : 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  messaging   : 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  security    : 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  leave       : 'M17 8l4 4m0 0l-4 4m4-4H3',
  incident    : 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
  telemedicine: 'M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z',
  chatbot     : 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  bills       : 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2',
  timeline    : 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  logout      : 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  collapse    : 'M11 19l-7-7 7-7M18 19l-7-7 7-7',
  expand      : 'M13 5l7 7-7 7M6 5l7 7-7 7',
  profile     : 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  handover    : 'M8 7h12M8 12h12M8 17h6M3 7h.01M3 12h.01M3 17h.01',
  shifts      : 'M12 8v4l3 3M3 12a9 9 0 1018 0 9 9 0 00-18 0z',
  departments : 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10',
};

// ── Nav config per role ───────────────────────────────────────────────────────
const NAV = {
  SUPER_ADMIN: [
    { label: 'Dashboard',       to: '/admin',               icon: 'dashboard' },
    { label: 'User Management', to: '/admin/users',         icon: 'users' },
    { label: 'Analytics',       to: '/admin/analytics',     icon: 'analytics' },
    { label: 'Audit Log',       to: '/admin/audit',         icon: 'audit' },
    { label: 'Broadcast',       to: '/admin/broadcast',     icon: 'broadcast' },
    { label: 'Financial',       to: '/admin/financial',     icon: 'financial' },
    { label: 'OT Calendar',     to: '/admin/ot',            icon: 'ot' },
    { label: 'Reports',         to: '/admin/reports',       icon: 'reports' },
    { label: 'HR Dashboard',    to: '/admin/hr',            icon: 'hr' },
    { label: 'Departments',     to: '/admin/departments',   icon: 'departments' },
    { label: 'Shifts',          to: '/admin/shifts',        icon: 'shifts' },
    { label: 'Inventory',       to: '/inventory',           icon: 'inventory' },
    { label: 'Bed Matrix',      to: '/inventory/beds',      icon: 'bed' },
    { label: 'Blood Bank',      to: '/inventory/blood',     icon: 'blood' },
    { label: 'Billing',         to: '/billing',             icon: 'billing' },
    { label: 'Security',        to: '/security',            icon: 'security' },
    { label: 'Messaging',       to: '/messaging',           icon: 'messaging' },
    { label: 'Apply Leave',     to: '/admin/leaves',        icon: 'leave' },
    { label: 'My Profile',      to: '/profile',             icon: 'profile' },
  ],
  ADMIN: [
    { label: 'Dashboard',       to: '/admin',               icon: 'dashboard' },
    { label: 'User Management', to: '/admin/users',         icon: 'users' },
    { label: 'Analytics',       to: '/admin/analytics',     icon: 'analytics' },
    { label: 'Audit Log',       to: '/admin/audit',         icon: 'audit' },
    { label: 'Broadcast',       to: '/admin/broadcast',     icon: 'broadcast' },
    { label: 'Financial',       to: '/admin/financial',     icon: 'financial' },
    { label: 'OT Calendar',     to: '/admin/ot',            icon: 'ot' },
    { label: 'Reports',         to: '/admin/reports',       icon: 'reports' },
    { label: 'HR Dashboard',    to: '/admin/hr',            icon: 'hr' },
    { label: 'Departments',     to: '/admin/departments',   icon: 'departments' },
    { label: 'Shifts',          to: '/admin/shifts',        icon: 'shifts' },
    { label: 'Messaging',       to: '/messaging',           icon: 'messaging' },
    { label: 'Apply Leave',     to: '/admin/leaves',        icon: 'leave' },
    { label: 'My Profile',      to: '/profile',             icon: 'profile' },
  ],
  DOCTOR: [
    { label: 'Dashboard',      to: '/doctor',                    icon: 'dashboard' },
    { label: 'Prescriptions',  to: '/doctor/prescriptions',      icon: 'prescription' },
    { label: 'Discharge',      to: '/doctor/discharge',          icon: 'discharge' },
    { label: 'OT Schedule',    to: '/admin/ot',                  icon: 'ot' },
    { label: 'Telemedicine',   to: '/doctor/telemedicine',       icon: 'telemedicine' },
    { label: 'Broadcasts',     to: '/broadcasts',                icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',                 icon: 'messaging' },
    { label: 'Apply Leave',    to: '/doctor/leaves',             icon: 'leave' },
    { label: 'Incident Report',to: '/doctor/incidents',          icon: 'incident' },
    { label: 'My Profile',     to: '/profile',                   icon: 'profile' },
  ],
  NURSE: [
    { label: 'Dashboard',      to: '/nurse',            icon: 'dashboard' },
    { label: 'Record Vitals',  to: '/nurse/vitals',     icon: 'vitals' },
    { label: 'Handover Notes', to: '/nurse/handover',   icon: 'handover' },
    { label: 'OT Schedule',    to: '/admin/ot',         icon: 'ot' },
    { label: 'Broadcasts',     to: '/broadcasts',       icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',    to: '/nurse/leaves',     icon: 'leave' },
    { label: 'Incident Report',to: '/nurse/incidents',  icon: 'incident' },
    { label: 'My Profile',     to: '/profile',          icon: 'profile' },
  ],
  RECEPTIONIST: [
    { label: 'Dashboard',      to: '/receptionist',              icon: 'dashboard' },
    { label: 'Patient List',   to: '/receptionist/patients',     icon: 'patient' },
    { label: 'Add Patient',    to: '/receptionist/patients/new', icon: 'users' },
    { label: 'OT Schedule',    to: '/admin/ot',                  icon: 'ot' },
    { label: 'Broadcasts',     to: '/broadcasts',                icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',                 icon: 'messaging' },
    { label: 'Apply Leave',    to: '/receptionist/leaves',       icon: 'leave' },
    { label: 'My Profile',     to: '/profile',                   icon: 'profile' },
  ],
  LAB_TECH: [
    { label: 'Dashboard',      to: '/lab',              icon: 'dashboard' },
    { label: 'Blood Bank',     to: '/lab/blood-bank',   icon: 'blood' },
    { label: 'Broadcasts',     to: '/broadcasts',       icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',    to: '/lab/leaves',       icon: 'leave' },
    { label: 'Incident Report',to: '/lab/incidents',    icon: 'incident' },
    { label: 'My Profile',     to: '/profile',          icon: 'profile' },
  ],
  PHARMACIST: [
    { label: 'Dashboard',      to: '/pharmacy',                  icon: 'dashboard' },
    { label: 'Broadcasts',     to: '/broadcasts',                icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',                 icon: 'messaging' },
    { label: 'Apply Leave',    to: '/pharmacy/leaves',           icon: 'leave' },
    { label: 'My Profile',     to: '/profile',                   icon: 'profile' },
  ],
  INVENTORY: [
    { label: 'Dashboard',      to: '/inventory',         icon: 'dashboard' },
    { label: 'Items',          to: '/inventory/items',   icon: 'inventory' },
    { label: 'Bed Matrix',     to: '/inventory/beds',    icon: 'bed' },
    { label: 'Blood Bank',     to: '/inventory/blood',   icon: 'blood' },
    { label: 'Generate QR',    to: '/inventory/qr/gen',  icon: 'qr' },
    { label: 'Scan QR',        to: '/inventory/qr/scan', icon: 'qr' },
    { label: 'Broadcasts',     to: '/broadcasts',        icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',         icon: 'messaging' },
    { label: 'My Profile',     to: '/profile',           icon: 'profile' },
  ],
  BILLING: [
    { label: 'Generate Bill',  to: '/billing',      icon: 'billing' },
    { label: 'Broadcasts',     to: '/broadcasts',   icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',    icon: 'messaging' },
    { label: 'My Profile',     to: '/profile',      icon: 'profile' },
  ],
  SECURITY_OFC: [
    { label: 'Dashboard',      to: '/security',     icon: 'security' },
    { label: 'Broadcasts',     to: '/broadcasts',   icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',    icon: 'messaging' },
    { label: 'My Profile',     to: '/profile',      icon: 'profile' },
  ],
  HR: [
    { label: 'Dashboard',      to: '/hr',           icon: 'dashboard' },
    { label: 'Manage Staff',   to: '/hr/staff',     icon: 'users' },
    { label: 'Shifts',         to: '/hr/shifts',    icon: 'shifts' },
    { label: 'Leave Requests', to: '/hr/leaves',    icon: 'leave' },
    { label: 'HR Reports',     to: '/admin/hr',     icon: 'hr' },
    { label: 'Broadcasts',     to: '/broadcasts',   icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',    icon: 'messaging' },
    { label: 'Incident Report',to: '/hr/incidents', icon: 'incident' },
    { label: 'My Profile',     to: '/profile',      icon: 'profile' },
  ],
  IT_ADMIN: [
    { label: 'Dashboard',      to: '/it',           icon: 'dashboard' },
    { label: 'Broadcasts',     to: '/broadcasts',   icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',    icon: 'messaging' },
    { label: 'My Profile',     to: '/profile',      icon: 'profile' },
  ],
  SOCIAL_WORKER: [
    { label: 'Dashboard',         to: '/social-worker',           icon: 'dashboard' },
    { label: 'Broadcasts',        to: '/broadcasts',              icon: 'broadcast' },
    { label: 'Messaging',         to: '/messaging',               icon: 'messaging' },
    { label: 'Apply Leave',       to: '/social-worker/leaves',    icon: 'leave' },
    { label: 'Incident Report',   to: '/social-worker/incidents', icon: 'incident' },
    { label: 'My Profile',        to: '/profile',                 icon: 'profile' },
  ],
  ORDERLY: [
    { label: 'Dashboard',      to: '/orderly',           icon: 'dashboard' },
    { label: 'Broadcasts',     to: '/broadcasts',        icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',         icon: 'messaging' },
    { label: 'Apply Leave',    to: '/orderly/leaves',    icon: 'leave' },
    { label: 'Incident Report',to: '/orderly/incidents', icon: 'incident' },
    { label: 'My Profile',     to: '/profile',           icon: 'profile' },
  ],
  DIETITIAN: [
    { label: 'Dashboard',      to: '/dietitian',           icon: 'dashboard' },
    { label: 'Broadcasts',     to: '/broadcasts',          icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',           icon: 'messaging' },
    { label: 'Apply Leave',    to: '/dietitian/leaves',    icon: 'leave' },
    { label: 'Incident Report',to: '/dietitian/incidents', icon: 'incident' },
    { label: 'My Profile',     to: '/profile',             icon: 'profile' },
  ],
  PHYSIO: [
    { label: 'Dashboard',      to: '/physio',           icon: 'dashboard' },
    { label: 'Broadcasts',     to: '/broadcasts',       icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',    to: '/physio/leaves',    icon: 'leave' },
    { label: 'Incident Report',to: '/physio/incidents', icon: 'incident' },
    { label: 'My Profile',     to: '/profile',          icon: 'profile' },
  ],
  RADIOLOGIST: [
    { label: 'Dashboard',      to: '/radiology',           icon: 'dashboard' },
    { label: 'Broadcasts',     to: '/broadcasts',          icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',           icon: 'messaging' },
    { label: 'Apply Leave',    to: '/radiology/leaves',    icon: 'leave' },
    { label: 'Incident Report',to: '/radiology/incidents', icon: 'incident' },
    { label: 'My Profile',     to: '/profile',             icon: 'profile' },
  ],
  ANESTHETIST: [
    { label: 'Dashboard',      to: '/anesthesia',           icon: 'dashboard' },
    { label: 'OT Schedule',    to: '/admin/ot',             icon: 'ot' },
    { label: 'Broadcasts',     to: '/broadcasts',           icon: 'broadcast' },
    { label: 'Messaging',      to: '/messaging',            icon: 'messaging' },
    { label: 'Apply Leave',    to: '/anesthesia/leaves',    icon: 'leave' },
    { label: 'Incident Report',to: '/anesthesia/incidents', icon: 'incident' },
    { label: 'My Profile',     to: '/profile',              icon: 'profile' },
  ],
  PATIENT: [
    { label: 'My Timeline',     to: '/patient/timeline',           icon: 'timeline' },
    { label: 'Appointments',    to: '/patient/appointments',       icon: 'appointment' },
    { label: 'Book Appointment',to: '/patient/appointments/book',  icon: 'appointment' },
    { label: 'My Vitals',       to: '/patient/vitals',             icon: 'vitals' },
    { label: 'Prescriptions',   to: '/patient/prescriptions',      icon: 'prescription' },
    { label: 'Lab Results',     to: '/patient/lab-results',        icon: 'lab' },
    { label: 'My Bills',        to: '/patient/bills',              icon: 'bills' },
    { label: 'Telemedicine',    to: '/patient/telemedicine',       icon: 'telemedicine' },
    { label: 'AI Chatbot',      to: '/patient/chatbot',            icon: 'chatbot' },
    { label: 'My Profile',      to: '/profile',                    icon: 'profile' },
  ],
};

// Fallback for roles not in NAV (HR, IT_ADMIN, etc.)
const FALLBACK_NAV = [
  { label: 'Messaging',      to: '/messaging',    icon: 'messaging' },
  { label: 'Apply Leave',    to: '/admin/leaves', icon: 'leave' },
  { label: 'My Profile',     to: '/profile',      icon: 'profile' },
];

export default function Sidebar({ onOpenSearch }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, clearAuth } = useStore();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { isDark, toggle: toggleDark, cycle: cycleTheme, theme } = useDarkMode();

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Close on outside click / escape
  useEffect(() => {
    if (!mobileOpen) return;
    function handler(e) { if (e.key === 'Escape') setMobileOpen(false); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen]);

  const primaryRole = user?.roles?.[0];
  const navItems = NAV[primaryRole] ?? FALLBACK_NAV;

  const handleLogout = async () => {
    try { await apiFetch(`${import.meta.env.VITE_API_URL ?? '/api'}/auth/logout`, { method: 'POST' }); } catch { /* ignore */ }
    clearSessionKey();
    clearAuth();
    navigate('/login');
  };

  // Detect mobile viewport
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    document.body.style.overflow = (isMobile && mobileOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, mobileOpen]);

  const sidebarInner = (
    <>
      {/* Header */}
      <div className={styles.header}>
        {!collapsed && (
          <div className={styles.brand}>
            <span className={styles.brandIcon}>🏥</span>
            <span className={styles.brandName}>HMS</span>
          </div>
        )}
        <button className={styles.collapseBtn} onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon d={collapsed ? ICONS.expand : ICONS.collapse} />
        </button>
        <button className={styles.mobileCloseBtn} onClick={() => setMobileOpen(false)}
          aria-label="Close menu">✕</button>
      </div>

      {/* User info */}
      {!collapsed && user && (
        <NavLink to="/profile" className={styles.userInfo} title="My Profile">
          <div className={styles.avatar}>{user.firstName?.[0]}{user.lastName?.[0]}</div>
          <div className={styles.userDetails}>
            <span className={styles.userName}>{user.firstName} {user.lastName}</span>
            <span className={styles.userRole}>{primaryRole?.replace(/_/g, ' ')}</span>
          </div>
        </NavLink>
      )}
      {collapsed && user && (
        <NavLink to="/profile" className={styles.userInfoCollapsed} title={`${user.firstName} ${user.lastName}`}>
          <div className={styles.avatar}>{user.firstName?.[0]}{user.lastName?.[0]}</div>
        </NavLink>
      )}

      {/* Nav */}
      <nav className={styles.nav} aria-label="Main navigation">
        {navItems.map(item => (
          <NavLink key={item.to} to={item.to}
            end={['/admin','/doctor','/nurse','/receptionist','/inventory'].includes(item.to)}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            title={collapsed ? item.label : undefined}>
            <span className={styles.navIcon}><Icon d={ICONS[item.icon]} /></span>
            {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom toolbar: search + dark mode + logout */}
      <div className={styles.bottomBar}>
        <button
          className={styles.toolBtn}
          onClick={onOpenSearch}
          title="Search (press /)"
          aria-label="Open search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          {!collapsed && <span>Search</span>}
          {!collapsed && <kbd className={styles.shortcutHint}>/</kbd>}
        </button>

        <button
          className={styles.toolBtn}
          onClick={cycleTheme}
          title={`Theme: ${theme} — click to cycle`}
          aria-label={`Current theme: ${theme}. Click to cycle themes.`}
        >
          <span aria-hidden="true">
            {theme === 'dark' ? '☀️' : theme === 'high-contrast' ? '🌙' : '🌓'}
          </span>
          {!collapsed && (
            <span>
              {theme === 'light' ? 'Dark Mode' : theme === 'dark' ? 'High Contrast' : 'Light Mode'}
            </span>
          )}
        </button>
      </div>

      <button className={styles.logoutBtn} onClick={handleLogout} title={collapsed ? 'Logout' : undefined}>
        <span className={styles.navIcon}><Icon d={ICONS.logout} /></span>
        {!collapsed && <span>Logout</span>}
      </button>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className={`${styles.hamburger} ${mobileOpen ? styles.open : ''}`}
        onClick={() => setMobileOpen(o => !o)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileOpen}
      >
        <span /><span /><span />
      </button>

      {/* Desktop sidebar — always visible */}
      {!isMobile && (
        <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
          {sidebarInner}
        </aside>
      )}

      {/* Mobile drawer — Framer Motion slide-in */}
      <AnimatePresence>
        {isMobile && mobileOpen && (
          <>
            <motion.div
              className={styles.overlay}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              className={styles.sidebar}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
            >
              {sidebarInner}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
