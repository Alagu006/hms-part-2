import { Link, useLocation } from 'react-router-dom';
import styles from './Breadcrumb.module.scss';

// Map path segments to human-readable labels
const LABELS = {
  admin       : 'Admin',
  doctor      : 'Doctor',
  nurse       : 'Nurse',
  receptionist: 'Receptionist',
  patient     : 'Patient',
  pharmacy    : 'Pharmacy',
  lab         : 'Lab',
  inventory   : 'Inventory',
  billing     : 'Billing',
  security    : 'Security',
  hr          : 'HR',
  it          : 'IT Admin',
  radiology   : 'Radiology',
  anesthesia  : 'Anesthesia',
  physio      : 'Physio',
  dietitian   : 'Dietitian',
  orderly     : 'Orderly',
  'social-worker': 'Social Worker',
  messaging   : 'Messaging',
  profile     : 'My Profile',
  broadcasts  : 'Broadcasts',
  users       : 'User Management',
  analytics   : 'Analytics',
  audit       : 'Audit Log',
  broadcast   : 'Broadcast',
  financial   : 'Financial',
  ot          : 'OT Calendar',
  reports     : 'Reports',
  departments : 'Departments',
  shifts      : 'Shifts',
  leaves      : 'Apply Leave',
  incidents   : 'Incident Report',
  prescriptions: 'Prescriptions',
  discharge   : 'Discharge',
  telemedicine: 'Telemedicine',
  vitals      : 'Vitals',
  handover    : 'Handover Notes',
  patients    : 'Patients',
  new         : 'New',
  beds        : 'Bed Matrix',
  blood       : 'Blood Bank',
  qr          : 'QR',
  gen         : 'Generate',
  scan        : 'Scan',
  items       : 'Items',
  timeline    : 'Timeline',
  appointments: 'Appointments',
  book        : 'Book',
  bills       : 'Bills',
  chatbot     : 'AI Chatbot',
  'lab-results': 'Lab Results',
  'patient-vitals': 'Patient Vitals',
  staff       : 'Staff',
};

function label(seg) {
  return LABELS[seg] ?? seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function Breadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length <= 1) return null; // no breadcrumb on top-level pages

  const crumbs = segments.map((seg, i) => ({
    label: label(seg),
    to   : '/' + segments.slice(0, i + 1).join('/'),
    last : i === segments.length - 1,
  }));

  return (
    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
      <ol className={styles.list}>
        <li className={styles.item}>
          <Link to="/" className={styles.link}>🏠</Link>
          <span className={styles.sep} aria-hidden="true">/</span>
        </li>
        {crumbs.map((c, i) => (
          <li key={i} className={styles.item}>
            {c.last ? (
              <span className={styles.current} aria-current="page">{c.label}</span>
            ) : (
              <>
                <Link to={c.to} className={styles.link}>{c.label}</Link>
                <span className={styles.sep} aria-hidden="true">/</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
