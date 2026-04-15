import { useEffect, useState, useCallback, Fragment } from 'react';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './OTCalendar.module.scss';

const API      = import.meta.env.VITE_API_URL ?? '/api';
const THEATRES = ['OT-1', 'OT-2', 'OT-3'];
const STATUSES = ['SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','POSTPONED'];

// Timeline: 6:00 – 22:00 in 30-min slots
const HOUR_START = 6;
const HOUR_END   = 22;
const SLOT_H     = 48; // px per 30-min slot
const SLOTS      = (HOUR_END - HOUR_START) * 2; // 32 slots

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function slotTop(dateStr, startISO) {
  const start = new Date(startISO);
  const mins  = start.getHours() * 60 + start.getMinutes() - HOUR_START * 60;
  return Math.max(0, (mins / 30) * SLOT_H);
}

function slotHeight(startISO, endISO) {
  const diff = (new Date(endISO) - new Date(startISO)) / 60_000;
  return Math.max(SLOT_H / 2, (diff / 30) * SLOT_H);
}

export default function OTCalendar() {
  const [date, setDate]         = useState(toDateStr(new Date()));
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  const fetchSchedules = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch(`${API}/ot-schedules?date=${d}`);
      setSchedules(Array.isArray(json) ? json : (json?.schedules ?? []));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchedules(date); }, [date, fetchSchedules]);

  const prevDay = () => {
    const d = new Date(date); d.setDate(d.getDate() - 1); setDate(toDateStr(d));
  };
  const nextDay = () => {
    const d = new Date(date); d.setDate(d.getDate() + 1); setDate(toDateStr(d));
  };

  // Group schedules by theatre
  const byTheatre = THEATRES.reduce((acc, t) => {
    acc[t] = schedules.filter(s => s.theatre === t);
    return acc;
  }, {});

  const totalHeight = SLOTS * SLOT_H;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>OT Schedule</h1>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.toolbar}>
        <button className={styles.navBtn} onClick={prevDay}>← Prev</button>
        <input
          type="date"
          className={styles.dateInput}
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <button className={styles.navBtn} onClick={nextDay}>Next →</button>
        <span className={styles.dateLabel}>
          {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}
        </span>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : (
        <>
          <div className={styles.timeline}>
            {/* Headers */}
            <div className={styles.timeHeader}>Time</div>
            {THEATRES.map(t => (
              <div key={t} className={styles.theatreHeader}>{t}</div>
            ))}

            {/* Time slots */}
            {Array.from({ length: SLOTS }, (_, i) => {
              const totalMins = HOUR_START * 60 + i * 30;
              const h = Math.floor(totalMins / 60);
              const m = totalMins % 60;
              const label = i % 2 === 0
                ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
                : '';
              return (
                <Fragment key={i}>
                  <div className={styles.timeCell}>{label}</div>
                  {THEATRES.map(theatre => (
                    <div key={`${theatre}-${i}`} className={styles.slotCell} />
                  ))}
                </Fragment>
              );
            })}
          </div>

          {/* Overlay events — positioned absolutely over the grid */}
          {/* We render a separate overlay layer per theatre column */}
          <div style={{ position: 'relative', marginTop: -totalHeight - SLOT_H }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(3, 1fr)', height: totalHeight + SLOT_H }}>
              <div /> {/* time column spacer */}
              {THEATRES.map(theatre => (
                <div key={theatre} style={{ position: 'relative', borderLeft: '1px solid transparent' }}>
                  {byTheatre[theatre].map(s => {
                    const top    = slotTop(date, s.scheduled_start);
                    const height = slotHeight(s.scheduled_start, s.scheduled_end);
                    return (
                      <div
                        key={s.id}
                        className={`${styles.event} ${styles[`s_${s.status}`]}`}
                        style={{ top: top + SLOT_H, height: height - 4 }}
                        title={`${s.procedure_name}\n${s.patient_first} ${s.patient_last}\nDr. ${s.doctor_first} ${s.doctor_last}`}
                      >
                        <div className={styles.eventTitle}>{s.procedure_name}</div>
                        <div className={styles.eventSub}>
                          {s.patient_first} {s.patient_last} · Dr. {s.doctor_last}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className={styles.legend}>
            {STATUSES.map(s => (
              <div key={s} className={styles.legendItem}>
                <div className={`${styles.legendDot} ${styles[`s_${s}`]}`} />
                {s.replace('_', ' ')}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
