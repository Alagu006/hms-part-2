import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styles from './BookAppointment.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionStorage.getItem('accessToken')}`,
  };
}

async function fetchDepartments() {
  const res = await fetch(`${API_BASE}/departments`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load departments');
  const json = await res.json();
  return json.departments ?? [];
}

async function fetchDoctors(departmentId) {
  const url = departmentId
    ? `${API_BASE}/doctors?departmentId=${departmentId}&limit=100`
    : `${API_BASE}/doctors?limit=100`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load doctors');
  const json = await res.json();
  return json.doctors ?? [];
}

async function fetchMyPatientId() {
  const res = await fetch(`${API_BASE}/patients/my`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load patient info');
  const json = await res.json();
  return json.data?.id;
}

// ---------------------------------------------------------------------------
// Simple month grid calendar
// ---------------------------------------------------------------------------
function MonthGrid({ selectedDate, onSelect }) {
  const [viewDate, setViewDate] = useState(() => selectedDate ? new Date(selectedDate) : new Date());

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)); }

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const selected = selectedDate ? new Date(selectedDate) : null;
  selected?.setHours(0, 0, 0, 0);

  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  return (
    <div className={styles.cal}>
      <div className={styles.calHeader}>
        <button type="button" className={styles.calNav} onClick={prevMonth} aria-label="Previous month">
          ←
        </button>
        <span className={styles.calMonthLabel}>{monthNames[month]} {year}</span>
        <button type="button" className={styles.calNav} onClick={nextMonth} aria-label="Next month">
          →
        </button>
      </div>
      <div className={styles.calGrid}>
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className={styles.calDayName}>{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const isPast   = date < today;
          const isSelected = selected && date.getTime() === selected.getTime();
          const isToday  = date.getTime() === today.getTime();
          return (
            <button
              key={date.toISOString()}
              type="button"
              className={`${styles.calDay}
                ${isPast    ? styles.calDayPast   : ''}
                ${isSelected? styles.calDaySelected: ''}
                ${isToday   ? styles.calDayToday  : ''}`}
              disabled={isPast}
              onClick={() => onSelect(date.toISOString().split('T')[0])}
              aria-label={date.toLocaleDateString()}
              aria-pressed={isSelected}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time slot picker
// ---------------------------------------------------------------------------
const SLOT_START = 9;  // 9 AM
const SLOT_END   = 17; // 5 PM
const SLOT_STEP  = 30; // minutes

function generateSlots() {
  const slots = [];
  for (let h = SLOT_START; h < SLOT_END; h++) {
    for (let m = 0; m < 60; m += SLOT_STEP) {
      const hour   = h % 12 || 12;
      const ampm   = h < 12 ? 'AM' : 'PM';
      const minute = String(m).padStart(2, '0');
      slots.push(`${String(hour).padStart(2,'0')}:${minute}`);
    }
  }
  return slots;
}

const ALL_SLOTS = generateSlots();

function TimeSlotPicker({ selectedTime, onSelect }) {
  return (
    <div className={styles.slots}>
      {ALL_SLOTS.map(slot => (
        <button
          key={slot}
          type="button"
          className={`${styles.slot} ${selectedTime === slot ? styles.slotSelected : ''}`}
          onClick={() => onSelect(slot)}
          aria-pressed={selectedTime === slot}
        >
          {(() => {
            const [h, m] = slot.split(':').map(Number);
            const hour = h % 12 || 12;
            const ampm = h < 12 ? 'AM' : 'PM';
            return `${hour}:${String(m).padStart(2,'0')} ${ampm}`;
          })()}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`${styles.toast} ${type === 'error' ? styles.toastError : styles.toastSuccess}`}>
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------
export default function BookAppointment() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep]         = useState(1);
  const [departmentId, setDept] = useState('');
  const [doctorId, setDoctor]   = useState('');
  const [date, setDate]        = useState('');
  const [time, setTime]         = useState('');
  const [type, setType]         = useState('IN_PERSON');
  const [reason, setReason]     = useState('');
  const [errors, setErrors]     = useState({});
  const [toast, setToast]       = useState(null);
  const [submitting, setSubmit] = useState(false);

  // Step 1: departments
  const { data: departments = [], isLoading: deptLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
  });

  // Step 2: doctors (refetch when dept changes)
  const { data: doctors = [], isLoading: docLoading } = useQuery({
    queryKey: ['doctors', departmentId],
    queryFn: () => fetchDoctors(departmentId || null),
    enabled: step >= 2,
  });

  function field(name, value) {
    setErrors(prev => ({ ...prev, [name]: undefined }));
    if (name === 'departmentId') {
      setDept(value);
      setDoctor('');
    }
    if (name === 'doctorId') setDoctor(value);
    if (name === 'type') setType(value);
  }

  function validateStep(s) {
    const errs = {};
    if (s === 1 && !departmentId) errs.departmentId = 'Select a department';
    if (s === 2 && !doctorId)    errs.doctorId = 'Select a doctor';
    if (s === 3 && !date)        errs.date = 'Pick a date';
    if (s === 3 && !time)        errs.time = 'Pick a time slot';
    if (s === 4 && reason.trim().length < 5) errs.reason = 'Please describe your reason (min 5 characters)';
    return errs;
  }

  function handleNext() {
    const errs = validateStep(step);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setStep(s => s + 1);
  }

  const bookingMutation = useMutation({
    mutationFn: async () => {
      const patientId = await fetchMyPatientId();
      const scheduledAt = `${date}T${time}:00.000Z`;
      const selectedDoctor = doctors.find(d => d.id === doctorId);
      const res = await fetch(`${API_BASE}/appointments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          patientId,
          doctorId,
          departmentId: selectedDoctor?.department_id || undefined,
          scheduledAt,
          durationMinutes: 30,
          type,
          reason: reason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Booking failed');
      return json.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-appointments'] });
      setToast({ message: 'Appointment booked successfully!', type: 'success' });
      setTimeout(() => navigate('/patient/appointments'), 1800);
    },
    onError: (err) => {
      setToast({ message: err.message, type: 'error' });
      setSubmit(false);
    },
  });

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validateStep(4);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmit(true);
    bookingMutation.mutate();
  }

  const selectedDoctor = doctors.find(d => d.id === doctorId);

  const stepLabels = ['Department', 'Doctor', 'Date & Time', 'Confirm'];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Book an Appointment</h1>

        {/* Stepper */}
        <div className={styles.stepper} role="list" aria-label="Booking steps">
          {stepLabels.map((label, i) => {
            const num = i + 1;
            const done = num < step;
            const active = num === step;
            return (
              <div key={label} className={`${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`} role="listitem">
                <div className={styles.stepCircle} aria-current={active ? 'step' : undefined}>
                  {done ? '✓' : num}
                </div>
                <span className={styles.stepLabel}>{label}</span>
                {i < stepLabels.length - 1 && <div className={`${styles.stepLine} ${done ? styles.stepLineDone : ''}`} />}
              </div>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.card}>

            {/* ── Step 1: Department ── */}
            {step === 1 && (
              <div className={styles.stepContent}>
                <h2 className={styles.stepTitle}>Select Department</h2>
                {deptLoading ? (
                  <div className={styles.loading}>Loading departments…</div>
                ) : (
                  <div className={styles.deptGrid}>
                    {departments.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        className={`${styles.deptCard} ${departmentId === d.id ? styles.deptCardSelected : ''}`}
                        onClick={() => field('departmentId', d.id)}
                        aria-pressed={departmentId === d.id}
                      >
                        <span className={styles.deptName}>{d.name}</span>
                        <span className={styles.deptCode}>{d.code}</span>
                      </button>
                    ))}
                  </div>
                )}
                {errors.departmentId && <p className={styles.fieldError}>{errors.departmentId}</p>}
              </div>
            )}

            {/* ── Step 2: Doctor ── */}
            {step === 2 && (
              <div className={styles.stepContent}>
                <h2 className={styles.stepTitle}>Select Doctor</h2>
                <button type="button" className={styles.backBtn} onClick={() => setStep(1)}>
                  ← Change department
                </button>
                {docLoading ? (
                  <div className={styles.loading}>Loading doctors…</div>
                ) : doctors.length === 0 ? (
                  <div className={styles.emptyState}>No doctors found for this department.</div>
                ) : (
                  <div className={styles.doctorList}>
                    {doctors.map(doc => (
                      <button
                        key={doc.id}
                        type="button"
                        className={`${styles.doctorCard} ${doctorId === doc.id ? styles.doctorCardSelected : ''}`}
                        onClick={() => field('doctorId', doc.id)}
                        aria-pressed={doctorId === doc.id}
                      >
                        <div className={styles.doctorAvatar}>
                          {doc.first_name?.[0]}{doc.last_name?.[0]}
                        </div>
                        <div className={styles.doctorInfo}>
                          <div className={styles.doctorName}>Dr. {doc.first_name} {doc.last_name}</div>
                          <div className={styles.doctorDept}>{doc.department_name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {errors.doctorId && <p className={styles.fieldError}>{errors.doctorId}</p>}
              </div>
            )}

            {/* ── Step 3: Date & Time ── */}
            {step === 3 && (
              <div className={styles.stepContent}>
                <h2 className={styles.stepTitle}>Pick a Date &amp; Time</h2>
                <button type="button" className={styles.backBtn} onClick={() => setStep(2)}>
                  ← Change doctor
                </button>
                <div className={styles.calSection}>
                  <MonthGrid selectedDate={date} onSelect={(d) => { field('date', d); }} />
                </div>
                {errors.date && <p className={styles.fieldError}>{errors.date}</p>}
                {date && (
                  <>
                    <h3 className={styles.subTitle}>Available Time Slots</h3>
                    {errors.time && <p className={styles.fieldError}>{errors.time}</p>}
                    <TimeSlotPicker selectedTime={time} onSelect={(t) => field('time', t)} />
                  </>
                )}
              </div>
            )}

            {/* ── Step 4: Confirm ── */}
            {step === 4 && (
              <div className={styles.stepContent}>
                <h2 className={styles.stepTitle}>Confirm Booking</h2>
                <button type="button" className={styles.backBtn} onClick={() => setStep(3)}>
                  ← Change date/time
                </button>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Doctor</span>
                    <span className={styles.summaryValue}>
                      Dr. {selectedDoctor?.first_name} {selectedDoctor?.last_name}
                    </span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Department</span>
                    <span className={styles.summaryValue}>{selectedDoctor?.department_name}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Date</span>
                    <span className={styles.summaryValue}>{date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '—'}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Time</span>
                    <span className={styles.summaryValue}>
                      {time ? (() => {
                        const [h, m] = time.split(':').map(Number);
                        const hour = h % 12 || 12;
                        return `${hour}:${String(m).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
                      })() : '—'}
                    </span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Type</span>
                    <div className={styles.typeToggle}>
                      <button
                        type="button"
                        className={`${styles.typeBtn} ${type === 'IN_PERSON' ? styles.typeBtnActive : ''}`}
                        onClick={() => field('type', 'IN_PERSON')}
                      >In-Person</button>
                      <button
                        type="button"
                        className={`${styles.typeBtn} ${type === 'TELEMEDICINE' ? styles.typeBtnActive : ''}`}
                        onClick={() => field('type', 'TELEMEDICINE')}
                      >Telemedicine</button>
                    </div>
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="reason">
                    Reason for Visit <span className={styles.req}>*</span>
                  </label>
                  <textarea
                    id="reason"
                    className={styles.textarea}
                    value={reason}
                    onChange={e => { setReason(e.target.value); setErrors(p => ({ ...p, reason: undefined })); }}
                    placeholder="Describe your symptoms or reason for the appointment…"
                    rows={4}
                    aria-required="true"
                  />
                  {errors.reason && <span className={styles.fieldError}>{errors.reason}</span>}
                </div>
              </div>
            )}

            {/* ── Navigation buttons ── */}
            <div className={styles.actions}>
              {step > 1 && step < 4 && (
                <button type="button" className={styles.backAction} onClick={() => setStep(s => s - 1)}>
                  Back
                </button>
              )}
              {step < 4 ? (
                <button type="button" className={styles.nextBtn} onClick={handleNext}>
                  Continue →
                </button>
              ) : (
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={submitting || bookingMutation.isPending}
                >
                  {submitting || bookingMutation.isPending ? 'Booking…' : 'Confirm Booking'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
