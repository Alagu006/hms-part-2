import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/index.js';

/**
 * Global keyboard shortcuts.
 *
 * Shortcuts (all require no modifier unless noted):
 *  /          → Open global search
 *  ?          → Show shortcuts help modal
 *  g h        → Go Home (role dashboard)
 *  g m        → Go to Messaging
 *  g p        → Go to My Profile
 *  g n        → Go to Notifications / Broadcasts
 *  d          → Doctor: Dashboard
 *  n          → Nurse: Record Vitals
 *  r          → Receptionist: Add Patient
 *  Escape     → Close any open modal (handled by individual components)
 *
 * Role-specific quick actions:
 *  DOCTOR     → p = Prescriptions, v = Patient Vitals
 *  NURSE      → v = Record Vitals, h = Handover Notes
 *  PATIENT    → a = Appointments, b = My Bills, x = My Prescriptions
 *  ADMIN      → u = User Management, l = Audit Log
 */

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

const ROLE_SHORTCUTS = {
  DOCTOR: {
    p: '/doctor/prescriptions',
    v: '/doctor/patient-vitals',
    d: '/doctor/discharge',
    t: '/doctor/telemedicine',
  },
  NURSE: {
    v: '/nurse/vitals',
    h: '/nurse/handover',
  },
  PATIENT: {
    a: '/patient/appointments',
    b: '/patient/bills',
    x: '/patient/prescriptions',
    l: '/patient/lab-results',
  },
  ADMIN: {
    u: '/admin/users',
    l: '/admin/audit',
    f: '/admin/financial',
    r: '/admin/reports',
  },
  SUPER_ADMIN: {
    u: '/admin/users',
    l: '/admin/audit',
    f: '/admin/financial',
    r: '/admin/reports',
  },
  RECEPTIONIST: {
    n: '/receptionist/patients/new',
    p: '/receptionist/patients',
  },
};

export function useKeyboardShortcuts({ onOpenSearch, onOpenHelp }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const user      = useStore(s => s.user);
  const role      = user?.roles?.[0];

  // Use a ref so the effect doesn't re-register on every navigation,
  // but the handler always reads the current pathname.
  const pathnameRef = useRef(location.pathname);
  useEffect(() => { pathnameRef.current = location.pathname; }, [location.pathname]);

  useEffect(() => {
    let gPressed = false;
    let gTimer   = null;

    function handler(e) {
      const tag = e.target.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      if (key === '/') {
        e.preventDefault();
        onOpenSearch?.();
        return;
      }

      if (key === '?') {
        e.preventDefault();
        onOpenHelp?.();
        return;
      }

      if (key === 'g') {
        gPressed = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPressed = false; }, 1000);
        return;
      }

      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimer);
        switch (key) {
          case 'h': navigate(ROLE_HOME[role] ?? '/'); break;
          case 'm': navigate('/messaging'); break;
          case 'p': navigate('/profile'); break;
          case 'n': navigate('/broadcasts'); break;
        }
        return;
      }

      const roleMap = ROLE_SHORTCUTS[role] ?? {};
      if (!roleMap[key]) return;

      e.preventDefault();

      const target     = roleMap[key];
      const alreadyHere = pathnameRef.current === target;

      // If already on the vitals page, focus the patient search input instead
      if (alreadyHere && (target === '/nurse/vitals' || target === '/doctor/patient-vitals')) {
        const input = document.querySelector(
          'input[aria-label="Search patient"], input[placeholder*="patient"], input[placeholder*="MRN"]'
        );
        if (input) { input.focus(); return; }
      }

      navigate(target);
    }

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(gTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, role, onOpenSearch, onOpenHelp]);
}
