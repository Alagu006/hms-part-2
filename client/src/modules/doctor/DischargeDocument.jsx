import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './DischargeDocument.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';

export default function DischargeDocument({ patientId, summaryId }) {
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const printRef = useRef(null);

  useEffect(() => {
    if (!patientId) return;
    apiFetch(`${API}/discharge-summaries/${patientId}`)
      .then((data) => setSummaries(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [patientId]);

  const summary = summaryId
    ? summaries.find(s => s.id === summaryId)
    : summaries[0];

  const handlePrint = () => window.print();

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;
  if (!summary) return <div className={styles.empty}>No discharge summary found.</div>;

  return (
    <div className={styles.wrapper}>
      <div className={styles.actions}>
        <button className={styles.printBtn} onClick={handlePrint}>
          Print / Save PDF
        </button>
      </div>

      <div className={styles.document} ref={printRef}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.hospitalName}>
            {import.meta.env.VITE_HOSPITAL_NAME ?? 'Hospital Management System'}
          </div>
          <div className={styles.docTitle}>DISCHARGE SUMMARY</div>
        </div>

        {/* Patient info */}
        <section className={styles.section}>
          <div className={styles.grid2}>
            <Field label="Patient Name"    value={`${summary.patient_first ?? ''} ${summary.patient_last ?? ''}`.trim() || '—'} />
            <Field label="Discharge Date"  value={fmt(summary.discharge_date)} />
            <Field label="Admission Date"  value={fmt(summary.admission_date)} />
            <Field label="Attending Doctor" value={`${summary.doctor_first ?? ''} ${summary.doctor_last ?? ''}`.trim() || '—'} />
          </div>
        </section>

        <hr className={styles.divider} />

        {/* Clinical */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Diagnosis</h3>
          <p className={styles.text}>{summary.final_diagnosis}</p>
        </section>

        {summary.treatment_summary && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Treatment Summary</h3>
            <p className={styles.text}>{summary.treatment_summary}</p>
          </section>
        )}

        {summary.medications_on_discharge && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Discharge Medications</h3>
            <p className={styles.text}>{summary.medications_on_discharge}</p>
          </section>
        )}

        {summary.follow_up_notes && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Instructions</h3>
            <p className={styles.text}>{summary.follow_up_notes}</p>
          </section>
        )}

        {summary.follow_up_date && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Follow-up Appointment</h3>
            <p className={styles.text}>{fmt(summary.follow_up_date)}</p>
          </section>
        )}

        <hr className={styles.divider} />

        {/* Signature */}
        <div className={styles.signatureRow}>
          <div className={styles.signatureBlock}>
            <div className={styles.signatureLine} />
            <div className={styles.signatureLabel}>Attending Physician</div>
          </div>
          <div className={styles.signatureBlock}>
            <div className={styles.signatureLine} />
            <div className={styles.signatureLabel}>Patient / Guardian</div>
          </div>
        </div>

        <div className={styles.footer}>
          Generated on {new Date().toLocaleString()} · {import.meta.env.VITE_HOSPITAL_NAME ?? 'HMS'}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  );
}

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
