import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './AddPatientForm.module.scss';

const INITIAL = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '',
  bloodGroup: '', email: '', phone: '', address: '', emergencyContact: '',
};

function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`${styles.toast} ${type === 'success' ? styles.success : styles.errorToast}`}
      role="alert" aria-live="assertive">
      {type === 'success' ? '✓' : '✕'} {message}
    </div>
  );
}

export default function AddPatientForm({ onClose, onSuccess }) {
  const navigate  = useNavigate();
  const isPage    = !onClose; // used as a full page when no onClose prop
  const [form, setForm]     = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast]   = useState(null);
  const [done, setDone]     = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  }

  function validate() {
    const errs = {};
    if (!form.firstName.trim())  errs.firstName   = 'First name is required';
    if (!form.lastName.trim())   errs.lastName    = 'Last name is required';
    if (!form.dateOfBirth)       errs.dateOfBirth = 'Date of birth is required';
    if (!form.gender)            errs.gender      = 'Gender is required';
    if (!form.email.trim())      errs.email       = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email';
    if (!form.phone.trim())      errs.phone       = 'Phone is required';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      await apiFetch(`${API_BASE}/patients`, { method: 'POST', body: JSON.stringify(body) });
      setToast({ message: 'Patient registered. Temporary password sent to email.', type: 'success' });
      setDone(true);
      onSuccess?.();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (onClose) onClose();
    else navigate('/receptionist/patients');
  }

  const formContent = (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="firstName">First Name <span className={styles.required}>*</span></label>
          <input id="firstName" name="firstName" className={`${styles.input} ${errors.firstName ? styles.error : ''}`}
            value={form.firstName} onChange={handleChange} autoComplete="given-name" />
          {errors.firstName && <span className={styles.errorText}>{errors.firstName}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lastName">Last Name <span className={styles.required}>*</span></label>
          <input id="lastName" name="lastName" className={`${styles.input} ${errors.lastName ? styles.error : ''}`}
            value={form.lastName} onChange={handleChange} autoComplete="family-name" />
          {errors.lastName && <span className={styles.errorText}>{errors.lastName}</span>}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="dateOfBirth">Date of Birth <span className={styles.required}>*</span></label>
          <input id="dateOfBirth" name="dateOfBirth" type="date"
            className={`${styles.input} ${errors.dateOfBirth ? styles.error : ''}`}
            value={form.dateOfBirth} onChange={handleChange} max={new Date().toISOString().split('T')[0]} />
          {errors.dateOfBirth && <span className={styles.errorText}>{errors.dateOfBirth}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="gender">Gender <span className={styles.required}>*</span></label>
          <select id="gender" name="gender" className={`${styles.select} ${errors.gender ? styles.error : ''}`}
            value={form.gender} onChange={handleChange}>
            <option value="">Select…</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
            <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
          </select>
          {errors.gender && <span className={styles.errorText}>{errors.gender}</span>}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">Email <span className={styles.required}>*</span></label>
          <input id="email" name="email" type="email"
            className={`${styles.input} ${errors.email ? styles.error : ''}`}
            value={form.email} onChange={handleChange} autoComplete="email" />
          {errors.email && <span className={styles.errorText}>{errors.email}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone">Phone <span className={styles.required}>*</span></label>
          <input id="phone" name="phone" type="tel"
            className={`${styles.input} ${errors.phone ? styles.error : ''}`}
            value={form.phone} onChange={handleChange} autoComplete="tel" />
          {errors.phone && <span className={styles.errorText}>{errors.phone}</span>}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="bloodGroup">Blood Group</label>
        <select id="bloodGroup" name="bloodGroup" className={styles.select} value={form.bloodGroup} onChange={handleChange}>
          <option value="">Unknown</option>
          {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="address">Address</label>
        <input id="address" name="address" className={styles.input} value={form.address} onChange={handleChange} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="emergencyContact">Emergency Contact</label>
        <input id="emergencyContact" name="emergencyContact" className={styles.input}
          value={form.emergencyContact} onChange={handleChange} placeholder="Name — Phone" />
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={handleClose}>
          {isPage ? '← Back' : 'Cancel'}
        </button>
        <button type="submit" className={styles.submitBtn} disabled={loading}>
          {loading ? 'Saving…' : 'Register Patient'}
        </button>
      </div>
    </form>
  );

  // Full page layout
  if (isPage) {
    return (
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <button className={styles.backBtn} onClick={handleClose}>← Back to Patients</button>
          <h1 className={styles.pageTitle}>Register New Patient</h1>
        </div>
        <div className={styles.pageCard}>
          {done ? (
            <div className={styles.successPage}>
              <div className={styles.successIcon}>✓</div>
              <h2>Patient Registered</h2>
              <p>Temporary password has been sent to the patient's email.</p>
              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button className={styles.submitBtn} onClick={() => { setDone(false); setForm(INITIAL); }}>
                  Add Another
                </button>
                <button className={styles.cancelBtn} onClick={handleClose}>
                  Back to Patients
                </button>
              </div>
            </div>
          ) : formContent}
        </div>
        {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      </div>
    );
  }

  // Modal layout (backward compat)
  return (
    <>
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="add-patient-title">
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <h2 id="add-patient-title">Add New Patient</h2>
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">✕</button>
          </div>
          {formContent}
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => { setToast(null); if (toast.type === 'success') handleClose(); }} />}
    </>
  );
}
