import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/index.js';
import styles from './GlobalSearch.module.scss';

// ── Icon map for nav items ────────────────────────────────────────────────────
const ICON_MAP = {
  dashboard   : '🏠', users       : '👥', analytics   : '📊', audit       : '📋',
  broadcast   : '📢', financial   : '💰', ot          : '🏨', reports     : '📄',
  hr          : '👤', patient     : '🧑', appointment : '📅', prescription: '💊',
  discharge   : '📋', vitals      : '💓', lab         : '🧪', pharmacy    : '💊',
  inventory   : '📦', bed         : '🛏',  blood       : '🩸', qr          : '🔲',
  billing     : '💳', messaging   : '💬', security    : '🔒', leave       : '🏖',
  incident    : '⚠️', telemedicine: '📹', chatbot     : '🤖', bills       : '💳',
  timeline    : '⏱',  handover    : '📝', shifts      : '🕐', departments : '🏢',
  profile     : '👤',
};

// ── Full nav config (mirrors Sidebar.jsx) ─────────────────────────────────────
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
    { label: 'Dashboard',       to: '/doctor',                    icon: 'dashboard' },
    { label: 'Prescriptions',   to: '/doctor/prescriptions',      icon: 'prescription' },
    { label: 'Discharge',       to: '/doctor/discharge',          icon: 'discharge' },
    { label: 'OT Schedule',     to: '/admin/ot',                  icon: 'ot' },
    { label: 'Telemedicine',    to: '/doctor/telemedicine',       icon: 'telemedicine' },
    { label: 'Patient Vitals',  to: '/doctor/patient-vitals',     icon: 'vitals' },
    { label: 'Broadcasts',      to: '/broadcasts',                icon: 'broadcast' },
    { label: 'Messaging',       to: '/messaging',                 icon: 'messaging' },
    { label: 'Apply Leave',     to: '/doctor/leaves',             icon: 'leave' },
    { label: 'Incident Report', to: '/doctor/incidents',          icon: 'incident' },
    { label: 'My Profile',      to: '/profile',                   icon: 'profile' },
  ],
  NURSE: [
    { label: 'Dashboard',       to: '/nurse',            icon: 'dashboard' },
    { label: 'Record Vitals',   to: '/nurse/vitals',     icon: 'vitals' },
    { label: 'Handover Notes',  to: '/nurse/handover',   icon: 'handover' },
    { label: 'OT Schedule',     to: '/admin/ot',         icon: 'ot' },
    { label: 'Broadcasts',      to: '/broadcasts',       icon: 'broadcast' },
    { label: 'Messaging',       to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',     to: '/nurse/leaves',     icon: 'leave' },
    { label: 'Incident Report', to: '/nurse/incidents',  icon: 'incident' },
    { label: 'My Profile',      to: '/profile',          icon: 'profile' },
  ],
  RECEPTIONIST: [
    { label: 'Dashboard',       to: '/receptionist',              icon: 'dashboard' },
    { label: 'Patient List',    to: '/receptionist/patients',     icon: 'patient' },
    { label: 'Add Patient',     to: '/receptionist/patients/new', icon: 'users' },
    { label: 'OT Schedule',     to: '/admin/ot',                  icon: 'ot' },
    { label: 'Broadcasts',      to: '/broadcasts',                icon: 'broadcast' },
    { label: 'Messaging',       to: '/messaging',                 icon: 'messaging' },
    { label: 'Apply Leave',     to: '/receptionist/leaves',       icon: 'leave' },
    { label: 'My Profile',      to: '/profile',                   icon: 'profile' },
  ],
  LAB_TECH: [
    { label: 'Dashboard',       to: '/lab',              icon: 'dashboard' },
    { label: 'Blood Bank',      to: '/lab/blood-bank',   icon: 'blood' },
    { label: 'Broadcasts',      to: '/broadcasts',       icon: 'broadcast' },
    { label: 'Messaging',       to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',     to: '/lab/leaves',       icon: 'leave' },
    { label: 'Incident Report', to: '/lab/incidents',    icon: 'incident' },
    { label: 'My Profile',      to: '/profile',          icon: 'profile' },
  ],
  PHARMACIST: [
    { label: 'Dashboard',       to: '/pharmacy',         icon: 'dashboard' },
    { label: 'Broadcasts',      to: '/broadcasts',       icon: 'broadcast' },
    { label: 'Messaging',       to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',     to: '/pharmacy/leaves',  icon: 'leave' },
    { label: 'My Profile',      to: '/profile',          icon: 'profile' },
  ],
  INVENTORY: [
    { label: 'Dashboard',       to: '/inventory',         icon: 'dashboard' },
    { label: 'Items',           to: '/inventory/items',   icon: 'inventory' },
    { label: 'Bed Matrix',      to: '/inventory/beds',    icon: 'bed' },
    { label: 'Blood Bank',      to: '/inventory/blood',   icon: 'blood' },
    { label: 'Generate QR',     to: '/inventory/qr/gen',  icon: 'qr' },
    { label: 'Scan QR',         to: '/inventory/qr/scan', icon: 'qr' },
    { label: 'Messaging',       to: '/messaging',         icon: 'messaging' },
    { label: 'My Profile',      to: '/profile',           icon: 'profile' },
  ],
  BILLING: [
    { label: 'Generate Bill',   to: '/billing',      icon: 'billing' },
    { label: 'Messaging',       to: '/messaging',    icon: 'messaging' },
    { label: 'My Profile',      to: '/profile',      icon: 'profile' },
  ],
  SECURITY_OFC: [
    { label: 'Dashboard',       to: '/security',     icon: 'security' },
    { label: 'Messaging',       to: '/messaging',    icon: 'messaging' },
    { label: 'My Profile',      to: '/profile',      icon: 'profile' },
  ],
  HR: [
    { label: 'Dashboard',       to: '/hr',           icon: 'dashboard' },
    { label: 'Manage Staff',    to: '/hr/staff',     icon: 'users' },
    { label: 'Shifts',          to: '/hr/shifts',    icon: 'shifts' },
    { label: 'Leave Requests',  to: '/hr/leaves',    icon: 'leave' },
    { label: 'HR Reports',      to: '/admin/hr',     icon: 'hr' },
    { label: 'Messaging',       to: '/messaging',    icon: 'messaging' },
    { label: 'Incident Report', to: '/hr/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',      icon: 'profile' },
  ],
  IT_ADMIN: [
    { label: 'Dashboard',       to: '/it',           icon: 'dashboard' },
    { label: 'Messaging',       to: '/messaging',    icon: 'messaging' },
    { label: 'My Profile',      to: '/profile',      icon: 'profile' },
  ],
  PATIENT: [
    { label: 'My Timeline',     to: '/patient/timeline',          icon: 'timeline' },
    { label: 'Appointments',    to: '/patient/appointments',      icon: 'appointment' },
    { label: 'Book Appointment',to: '/patient/appointments/book', icon: 'appointment' },
    { label: 'My Vitals',       to: '/patient/vitals',            icon: 'vitals' },
    { label: 'Prescriptions',   to: '/patient/prescriptions',     icon: 'prescription' },
    { label: 'Lab Results',     to: '/patient/lab-results',       icon: 'lab' },
    { label: 'My Bills',        to: '/patient/bills',             icon: 'bills' },
    { label: 'Telemedicine',    to: '/patient/telemedicine',      icon: 'telemedicine' },
    { label: 'AI Chatbot',      to: '/patient/chatbot',           icon: 'chatbot' },
    { label: 'My Profile',      to: '/profile',                   icon: 'profile' },
  ],
  SOCIAL_WORKER: [
    { label: 'Dashboard',       to: '/social-worker',           icon: 'dashboard' },
    { label: 'Messaging',       to: '/messaging',               icon: 'messaging' },
    { label: 'Apply Leave',     to: '/social-worker/leaves',    icon: 'leave' },
    { label: 'Incident Report', to: '/social-worker/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',                 icon: 'profile' },
  ],
  ORDERLY: [
    { label: 'Dashboard',       to: '/orderly',           icon: 'dashboard' },
    { label: 'Messaging',       to: '/messaging',         icon: 'messaging' },
    { label: 'Apply Leave',     to: '/orderly/leaves',    icon: 'leave' },
    { label: 'Incident Report', to: '/orderly/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',           icon: 'profile' },
  ],
  DIETITIAN: [
    { label: 'Dashboard',       to: '/dietitian',           icon: 'dashboard' },
    { label: 'Messaging',       to: '/messaging',           icon: 'messaging' },
    { label: 'Apply Leave',     to: '/dietitian/leaves',    icon: 'leave' },
    { label: 'Incident Report', to: '/dietitian/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',             icon: 'profile' },
  ],
  PHYSIO: [
    { label: 'Dashboard',       to: '/physio',           icon: 'dashboard' },
    { label: 'Messaging',       to: '/messaging',        icon: 'messaging' },
    { label: 'Apply Leave',     to: '/physio/leaves',    icon: 'leave' },
    { label: 'Incident Report', to: '/physio/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',          icon: 'profile' },
  ],
  RADIOLOGIST: [
    { label: 'Dashboard',       to: '/radiology',           icon: 'dashboard' },
    { label: 'Messaging',       to: '/messaging',           icon: 'messaging' },
    { label: 'Apply Leave',     to: '/radiology/leaves',    icon: 'leave' },
    { label: 'Incident Report', to: '/radiology/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',             icon: 'profile' },
  ],
  ANESTHETIST: [
    { label: 'Dashboard',       to: '/anesthesia',           icon: 'dashboard' },
    { label: 'OT Schedule',     to: '/admin/ot',             icon: 'ot' },
    { label: 'Messaging',       to: '/messaging',            icon: 'messaging' },
    { label: 'Apply Leave',     to: '/anesthesia/leaves',    icon: 'leave' },
    { label: 'Incident Report', to: '/anesthesia/incidents', icon: 'incident' },
    { label: 'My Profile',      to: '/profile',              icon: 'profile' },
  ],
};

// ── Client-side nav search ────────────────────────────────────────────────────
function searchNav(query, roles = []) {
  const q = query.toLowerCase().trim();
  const seen = new Set();
  const results = [];

  for (const role of roles) {
    for (const item of (NAV[role] ?? [])) {
      if (seen.has(item.to)) continue;
      if (item.label.toLowerCase().includes(q) || item.to.toLowerCase().includes(q)) {
        seen.add(item.to);
        results.push({
          id   : item.to,
          title: item.label,
          sub  : item.to,
          icon : ICON_MAP[item.icon] ?? '📄',
          href : item.to,
          type : 'page',
        });
      }
    }
  }
  return results.slice(0, 8);
}

// ── Components ────────────────────────────────────────────────────────────────
function ResultItem({ item, onSelect }) {
  return (
    <button className={styles.resultItem} onClick={() => onSelect(item)}>
      <span className={styles.resultIcon}>{item.icon}</span>
      <div className={styles.resultText}>
        <span className={styles.resultTitle}>{item.title}</span>
        {item.sub && <span className={styles.resultSub}>{item.sub}</span>}
      </div>
      <span className={`${styles.resultType} ${styles[`type_${item.type}`] ?? ''}`}>
        {item.type}
      </span>
    </button>
  );
}

export default function GlobalSearch({ onClose }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();
  const user     = useStore(s => s.user);
  const roles    = user?.roles ?? [];

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }

    // Client-side nav search — instant, no network call
    const navResults = searchNav(q, roles);
    setResults(navResults);
    setSelected(0);
  }, [roles]);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 200);
  }

  function handleSelect(item) {
    navigate(item.href);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && results[selected]) {
      handleSelect(results[selected]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Global search">
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <span className={styles.searchIcon} aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search pages, patients, staff…"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-label="Search"
            autoComplete="off"
          />
          <kbd className={styles.escHint}>Esc</kbd>
        </div>

        {results.length > 0 && (
          <div className={styles.results} role="listbox">
            {results.map((item, i) => (
              <div
                key={item.id}
                className={`${styles.resultWrapper} ${i === selected ? styles.highlighted : ''}`}
                role="option"
                aria-selected={i === selected}
              >
                <ResultItem item={item} onSelect={handleSelect} />
              </div>
            ))}
          </div>
        )}

        {query.length >= 2 && results.length === 0 && (
          <div className={styles.empty}>No results for "{query}"</div>
        )}

        <div className={styles.footer}>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
