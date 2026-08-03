import { useState, useEffect, useCallback } from 'react';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './BedMatrix.module.scss';

const STATUS_LABELS = {
  AVAILABLE  : 'Available',
  OCCUPIED   : 'Occupied',
  MAINTENANCE: 'Maintenance',
  RESERVED   : 'Reserved',
};

const ROOM_TYPES = ['GENERAL', 'ICU', 'PRIVATE', 'SEMI_PRIVATE', 'EMERGENCY', 'OT', 'ISOLATION'];
const FLOORS = [
  { label: 'Ground (0)', value: 0 },
  ...Array.from({ length: 10 }, (_, i) => ({ label: `Floor ${i + 1}`, value: i + 1 })),
];

// ---------------------------------------------------------------------------
// Add Room Modal
// ---------------------------------------------------------------------------
function AddRoomModal({ onSave, onClose }) {
  const [form, setForm] = useState({ roomNumber: '', roomType: 'GENERAL', floor: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch(`${API_BASE}/inventory/beds/rooms`, {
        method: 'POST',
        body: JSON.stringify({ ...form, floor: Number(form.floor) }),
      });
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3>Add Room</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className={styles.modalBody} onSubmit={handleSave}>
          <label className={styles.fieldLabel}>Room Number
            <input className={styles.input} value={form.roomNumber} required
              onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))} />
          </label>
          <label className={styles.fieldLabel}>Room Type
            <select className={styles.input} value={form.roomType}
              onChange={e => setForm(f => ({ ...f, roomType: e.target.value }))}>
              {ROOM_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className={styles.fieldLabel}>Floor
            <select className={styles.input} value={form.floor}
              onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}>
              {FLOORS.map(fl => <option key={fl.value} value={fl.value}>{fl.label}</option>)}
            </select>
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Add Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Bed Modal
// ---------------------------------------------------------------------------
function AddBedModal({ room, onSave, onClose }) {
  const [bedNumber, setBedNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch(`${API_BASE}/inventory/beds/rooms/${room.id}/beds`, {
        method: 'POST',
        body: JSON.stringify({ bedNumber }),
      });
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3>Add Bed to {room.roomNumber}</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className={styles.modalBody} onSubmit={handleSave}>
          <label className={styles.fieldLabel}>Bed Number
            <input className={styles.input} value={bedNumber} required
              onChange={e => setBedNumber(e.target.value)} />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Add Bed'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bed status update modal
// ---------------------------------------------------------------------------
function BedModal({ bed, onSave, onClose }) {
  const [status, setStatus] = useState(bed.status);
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const json = await apiFetch(`${API_BASE}/inventory/beds/${bed.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });
      onSave(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3>Bed {bed.bedNumber}</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        {bed.patient && (
          <div className={styles.patientInfo}>
            <span className={styles.patientLabel}>Current patient</span>
            <span>{bed.patient.firstName} {bed.patient.lastName}</span>
            <span className={styles.mrn}>{bed.patient.mrn}</span>
          </div>
        )}

        <div className={styles.modalBody}>
          <label className={styles.fieldLabel}>Status</label>
          <div className={styles.statusGroup} role="group">
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`${styles.statusBtn} ${styles[val.toLowerCase()]} ${status === val ? styles.selected : ''}`}
                onClick={() => setStatus(val)}
                aria-pressed={status === val}
              >
                {label}
              </button>
            ))}
          </div>

          <label className={styles.fieldLabel} htmlFor="bed-notes">Notes (optional)</label>
          <textarea
            id="bed-notes"
            className={styles.notesInput}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Reason for status change…"
          />

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BedMatrix
// ---------------------------------------------------------------------------
export default function BedMatrix({ roomsOnly = false }) {
  const [rooms,       setRooms]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selectedBed, setSelectedBed] = useState(null);
  const [filterType,  setFilterType]  = useState('ALL');
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [addBedRoom,  setAddBedRoom]  = useState(null);

  const fetchBeds = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiFetch(`${API_BASE}/inventory/beds`);
      if (json) setRooms(json.data ?? []);
    } catch (e) {
      console.error('[BedMatrix]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBeds(); }, [fetchBeds]);

  function handleSaved() {
    setSelectedBed(null);
    setShowAddRoom(false);
    setAddBedRoom(null);
    fetchBeds();
  }

  const roomTypes = ['ALL', ...new Set(rooms.map(r => r.roomType))];
  const filtered  = filterType === 'ALL' ? rooms : rooms.filter(r => r.roomType === filterType);

  const allBeds = rooms.flatMap(r => r.beds);
  const counts = {
    AVAILABLE  : allBeds.filter(b => b.status === 'AVAILABLE').length,
    OCCUPIED   : allBeds.filter(b => b.status === 'OCCUPIED').length,
    MAINTENANCE: allBeds.filter(b => b.status === 'MAINTENANCE').length,
    RESERVED   : allBeds.filter(b => b.status === 'RESERVED').length,
  };

  if (loading) return <div className={styles.loading}>Loading bed matrix…</div>;

  return (
    <div className={styles.wrapper}>
      <div className={styles.topBar}>
        <div className={styles.legend}>
          <span className={`${styles.dot} ${styles.available}`} />Available ({counts.AVAILABLE})
          <span className={`${styles.dot} ${styles.occupied}`} />Occupied ({counts.OCCUPIED})
          <span className={`${styles.dot} ${styles.maintenance}`} />Maintenance ({counts.MAINTENANCE})
          <span className={`${styles.dot} ${styles.reserved}`} />Reserved ({counts.RESERVED})
        </div>

        <div className={styles.topBarRight}>
          <div className={styles.filterGroup} role="group" aria-label="Filter by room type">
            {roomTypes.map(t => (
              <button
                key={t}
                className={`${styles.filterBtn} ${filterType === t ? styles.activeFilter : ''}`}
                onClick={() => setFilterType(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button className={styles.addRoomBtn} onClick={() => setShowAddRoom(true)}>
            + Add Room
          </button>
        </div>
      </div>

      <div className={styles.roomList}>
        {filtered.map(room => (
          <div key={room.id} className={styles.roomCard}>
            <div className={styles.roomHeader}>
              <span className={styles.roomNumber}>{room.roomNumber}</span>
              <span className={styles.roomType}>{room.roomType}</span>
              {room.departmentName && <span className={styles.deptName}>{room.departmentName}</span>}
              {room.floor !== undefined && <span className={styles.floor}>Floor {room.floor}</span>}
              <button
                className={styles.addBedBtn}
                onClick={() => setAddBedRoom(room)}
                title="Add bed to this room"
              >
                + Bed
              </button>
            </div>

            {roomsOnly ? (
              <div className={styles.roomMeta}>
                {room.beds.length} bed{room.beds.length !== 1 ? 's' : ''}
              </div>
            ) : (
              <div className={styles.bedGrid}>
                {room.beds.length === 0 ? (
                  <span className={styles.noBeds}>No beds configured</span>
                ) : (
                  room.beds.map(bed => (
                    <button
                      key={bed.id}
                      className={`${styles.bedCell} ${styles[bed.status.toLowerCase()]}`}
                      onClick={() => setSelectedBed(bed)}
                      title={`Bed ${bed.bedNumber} — ${STATUS_LABELS[bed.status]}${bed.patient ? ` (${bed.patient.firstName} ${bed.patient.lastName})` : ''}`}
                      aria-label={`Bed ${bed.bedNumber}, ${STATUS_LABELS[bed.status]}`}
                    >
                      <span className={styles.bedNum}>{bed.bedNumber}</span>
                      {bed.patient && (
                        <span className={styles.bedPatient}>
                          {bed.patient.firstName[0]}{bed.patient.lastName[0]}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && <div className={styles.empty}>No rooms found</div>}
      </div>

      {showAddRoom && <AddRoomModal onSave={handleSaved} onClose={() => setShowAddRoom(false)} />}
      {addBedRoom  && <AddBedModal room={addBedRoom} onSave={handleSaved} onClose={() => setAddBedRoom(null)} />}
      {selectedBed && <BedModal bed={selectedBed} onSave={handleSaved} onClose={() => setSelectedBed(null)} />}
    </div>
  );
}
