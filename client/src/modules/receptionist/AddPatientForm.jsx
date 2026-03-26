import { useState, useEffect } from 'react';
import styles from './AddPatientForm.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

const INITIAL = {
  firstName       : '',
  lastName        : '',
  dateOfBirth     : '',
  gender          : '',
  bloodGroup      : '',
  email           : '',
  phone           : '',
  address         : '',
  emergencyContact: '',
};

function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className={`${styles.toast} ${type === 'success' ? styles.success : styles.errorToast}`}
      role="alert"
      aria-live="assertive"
    >
      {type === 'success' ? '✓' : '✕'} {message}
    </div>
  );
}

export default function AddPatientForm({ onClose, onSuccess }) {
  const [form, setForm]       = useState(INITIAL);
  const [errors, setErrors]   = useState({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  }

  function validate() {
    const errs = {};
    if (!form.firstName.trim())  errs.firstName   = 'First name is required';
    if (!form.lastName.trim())   errs.lastName    = 'Last name is required';
    if (!form.dateOfBirth)       errs.dateOfBirth = 'Date of birth is required';
    if (!form.gender)            errs.gender      = 'Gender is required';
    if (!form.email.trim())      errs.email       = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
                                 errs.email       = 'Invalid email address';
    if (!form.phone.trim())      errs.phone       = 'Phone is required';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    try {
      const body = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '')
      );

      const res = await fetch(`${API_BASE}/patients`, {
        method : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to create patient');
      }

      setToast({ message: 'Patient added. Temporary password sent to email.', type: 'success' });
      onSuccess?.();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="add-patient-title">
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <h2 id="add-patient-title">Add New Patient</h2>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="firstName">
                  First Name <span className={styles.required}>*</span>
                </label>
                <input
                  id="firstName" name="firstName" className={`${styles.input} ${errors.firstName ? styles.error : ''}`}
                  value={form.firstName} onChange={handleChange} autoComplete="given-name"
                />
                {errors.firstName && <span className={styles.errorText}>{errors.firstName}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="lastName">
                  Last Name <span className={styles.required}>*</span>
                </label>
                <input
                  id="lastName" name="lastName" className={`${styles.input} ${errors.lastName ? styles.error : ''}`}
                  value={form.lastName} onChange={handleChange} autoComplete="family-name"
                />
                {errors.lastName && <span className={styles.errorText}>{errors.lastName}</span>}
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="dateOfBirth">
                  Date of Birth <span className={styles.required}>*</span>
                </label>
                <input
                  id="dateOfBirth" name="dateOfBirth" type="date"
                  className={`${styles.input} ${errors.dateOfBirth ? styles.error : ''}`}
                  value={form.dateOfBirth} onChange={handleChange}
                  max={new Date().toISOString().split('T')[0]}
                />
                {errors.dateOfBirth && <span className={styles.errorText}>{errors.dateOfBirth}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="gender">
                  Gender <span className={styles.required}>*</span>
                </label>
                <select
                  id="gender" name="gender"
                  className={`${styles.select} ${errors.gender ? styles.error : ''}`}
                  value={form.gender} onChange={handleChange}
                >
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
                <label className={styles.label} htmlFor="email">
                  Email <span className={styles.required}>*</span>
                </label>
                <input
                  id="email" name="email" type="email"
                  className={`${styles.input} ${errors.email ? styles.error : ''}`}
                  value={form.email} onChange={handleChange} autoComplete="email"
                />
                {errors.email && <span className={styles.errorText}>{errors.email}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="phone">
                  Phone <span className={styles.required}>*</span>
                </label>
                <input
                  id="phone" name="phone" type="tel"
                  className={`${styles.input} ${errors.phone ? styles.error : ''}`}
                  value={form.phone} onChange={handleChange} autoComplete="tel"
                />
                {errors.phone && <span className={styles.errorText}>{errors.phone}</span>}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="bloodGroup">Blood Group</label>
              <select id="bloodGroup" name="bloodGroup" className={styles.select} value={form.bloodGroup} onChange={handleChange}>
                <option value="">Unknown</option>
                {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="address">Address</label>
              <input id="address" name="address" className={styles.input} value={form.address} onChange={handleChange} autoComplete="street-address" />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="emergencyContact">Emergency Contact</label>
              <input id="emergencyContact" name="emergencyContact" className={styles.input} value={form.emergencyContact} onChange={handleChange} placeholder="Name — Phone" />
            </div>
          </form>

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.submitBtn} disabled={loading} onClick={handleSubmit}>
              {loading ? 'Saving…' : 'Add Patient'}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => {
            setToast(null);
            if (toast.type === 'success') onClose?.();
          }}
        />
      )}
    </>
  );
}
