import { useEffect } from 'react';
import { useStore } from '../store/index.js';
import styles from './KeyboardShortcutsHelp.module.scss';

const GLOBAL_SHORTCUTS = [
  { keys: ['/'],        desc: 'Open global search' },
  { keys: ['?'],        desc: 'Show this help panel' },
  { keys: ['g', 'h'],   desc: 'Go to Home dashboard' },
  { keys: ['g', 'm'],   desc: 'Go to Messaging' },
  { keys: ['g', 'p'],   desc: 'Go to My Profile' },
  { keys: ['g', 'n'],   desc: 'Go to Broadcasts / Notifications' },
];

const ROLE_SHORTCUTS = {
  DOCTOR: [
    { keys: ['p'], desc: 'Prescriptions' },
    { keys: ['v'], desc: 'Patient Vitals' },
    { keys: ['d'], desc: 'Discharge Form' },
    { keys: ['t'], desc: 'Telemedicine' },
  ],
  NURSE: [
    { keys: ['v'], desc: 'Record Vitals' },
    { keys: ['h'], desc: 'Handover Notes' },
  ],
  PATIENT: [
    { keys: ['a'], desc: 'My Appointments' },
    { keys: ['b'], desc: 'My Bills' },
    { keys: ['x'], desc: 'My Prescriptions' },
    { keys: ['l'], desc: 'Lab Results' },
  ],
  ADMIN: [
    { keys: ['u'], desc: 'User Management' },
    { keys: ['l'], desc: 'Audit Log' },
    { keys: ['f'], desc: 'Financial Summary' },
    { keys: ['r'], desc: 'Reports' },
  ],
  SUPER_ADMIN: [
    { keys: ['u'], desc: 'User Management' },
    { keys: ['l'], desc: 'Audit Log' },
    { keys: ['f'], desc: 'Financial Summary' },
    { keys: ['r'], desc: 'Reports' },
  ],
  RECEPTIONIST: [
    { keys: ['n'], desc: 'Add New Patient' },
    { keys: ['p'], desc: 'Patient List' },
  ],
};

function Kbd({ children }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

function ShortcutRow({ keys, desc }) {
  return (
    <div className={styles.row}>
      <div className={styles.keys}>
        {keys.map((k, i) => (
          <span key={i}>
            <Kbd>{k}</Kbd>
            {i < keys.length - 1 && <span className={styles.then}>then</span>}
          </span>
        ))}
      </div>
      <span className={styles.desc}>{desc}</span>
    </div>
  );
}

export default function KeyboardShortcutsHelp({ onClose }) {
  const user = useStore(s => s.user);
  const role = user?.roles?.[0];
  const roleSpecific = ROLE_SHORTCUTS[role] ?? [];

  useEffect(() => {
    function handler(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          <section>
            <h3 className={styles.sectionTitle}>Global</h3>
            {GLOBAL_SHORTCUTS.map((s, i) => <ShortcutRow key={i} {...s} />)}
          </section>

          {roleSpecific.length > 0 && (
            <section>
              <h3 className={styles.sectionTitle}>
                {role?.replace(/_/g, ' ')} Quick Actions
              </h3>
              {roleSpecific.map((s, i) => <ShortcutRow key={i} {...s} />)}
            </section>
          )}
        </div>

        <div className={styles.footer}>
          Press <Kbd>?</Kbd> anytime to open this panel
        </div>
      </div>
    </div>
  );
}
