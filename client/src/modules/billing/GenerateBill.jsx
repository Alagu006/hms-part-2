import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './GenerateBill.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';
const token = () => sessionStorage.getItem('accessToken');

const CATEGORIES = ['CONSULTATION','PROCEDURE','MEDICINE','LAB','ROOM','EQUIPMENT','OTHER'];

function fmt(n) {
  return Number(n ?? 0).toFixed(2);
}

// ---------------------------------------------------------------------------
// Patient search
// ---------------------------------------------------------------------------
function PatientSearch({ onSelect }) {
  const [q, setQ]           = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/patients?search=${encodeURIComponent(q)}&limit=8`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const json = await r.json();
        setResults(json.data ?? json.rows ?? []);
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className={styles.patientSearch}>
      <input
        className={styles.input}
        placeholder="Search patient by name or MRN…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search patient"
      />
      {loading && <p className={styles.hint}>Searching…</p>}
      {results.length > 0 && (
        <ul className={styles.dropdown} role="listbox">
          {results.map((p) => (
            <li key={p.id} role="option" tabIndex={0}
              className={styles.dropdownItem}
              onClick={() => { onSelect(p); setQ(''); setResults([]); }}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(p)}>
              <strong>{p.first_name} {p.last_name}</strong>
              <span className={styles.mrn}>MRN: {p.mrn}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line item row
// ---------------------------------------------------------------------------
function LineItem({ item, idx, onChange, onRemove, userRole }) {
  const needsApproval = (item.discount ?? 0) > 20 && !['ADMIN','SUPER_ADMIN'].includes(userRole);
  return (
    <tr className={styles.lineRow}>
      <td>
        <input className={styles.inputSm} value={item.description}
          onChange={(e) => onChange(idx, 'description', e.target.value)}
          placeholder="Description" aria-label="Item description" />
      </td>
      <td>
        <select className={styles.inputSm} value={item.category}
          onChange={(e) => onChange(idx, 'category', e.target.value)}
          aria-label="Category">
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </td>
      <td>
        <input className={styles.inputSm} type="number" min="1" value={item.quantity}
          onChange={(e) => onChange(idx, 'quantity', +e.target.value)}
          aria-label="Quantity" />
      </td>
      <td>
        <input className={styles.inputSm} type="number" min="0" step="0.01" value={item.unitPrice}
          onChange={(e) => onChange(idx, 'unitPrice', +e.target.value)}
          aria-label="Unit price" />
      </td>
      <td>
        <input className={`${styles.inputSm} ${needsApproval ? styles.warnInput : ''}`}
          type="number" min="0" max="100" value={item.discount}
          onChange={(e) => onChange(idx, 'discount', +e.target.value)}
          aria-label="Discount percent" />
        {needsApproval && <span className={styles.warnBadge}>Needs admin approval</span>}
      </td>
      <td className={styles.lineTotal}>₹{fmt(item.unitPrice * item.quantity * (1 - (item.discount ?? 0) / 100))}</td>
      <td>
        <button className={styles.removeBtn} onClick={() => onRemove(idx)} aria-label="Remove item">✕</button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Print preview
// ---------------------------------------------------------------------------
function PrintPreview({ bill, patient, items, subtotal, taxAmount, netAmount, taxPercent, onClose }) {
  const printRef = useRef();

  const handlePrint = () => window.print();

  return (
    <div className={styles.previewOverlay} role="dialog" aria-modal="true" aria-label="Bill preview">
      <div className={styles.previewBox} ref={printRef}>
        {/* Letterhead */}
        <div className={styles.letterhead}>
          <h1 className={styles.hospitalName}>City General Hospital</h1>
          <p className={styles.hospitalAddr}>123 Medical Lane, Healthcare City · Tel: +91-XXXXXXXXXX</p>
          <hr className={styles.divider} />
          <h2 className={styles.billTitle}>TAX INVOICE</h2>
        </div>

        <div className={styles.billMeta}>
          <div>
            <p><strong>Patient:</strong> {patient.first_name} {patient.last_name}</p>
            <p><strong>MRN:</strong> {patient.mrn}</p>
          </div>
          <div>
            <p><strong>Date:</strong> {new Date().toLocaleDateString('en-IN')}</p>
            <p><strong>Bill #:</strong> {bill?.bill_number ?? 'PREVIEW'}</p>
          </div>
        </div>

        <table className={styles.previewTable}>
          <thead>
            <tr>
              <th>Description</th><th>Category</th><th>Qty</th>
              <th>Unit Price</th><th>Disc%</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td>{item.description}</td>
                <td>{item.category}</td>
                <td>{item.quantity}</td>
                <td>₹{fmt(item.unitPrice)}</td>
                <td>{item.discount ?? 0}%</td>
                <td>₹{fmt(item.unitPrice * item.quantity * (1 - (item.discount ?? 0) / 100))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className={styles.tfootLabel}>Subtotal</td><td>₹{fmt(subtotal)}</td></tr>
            <tr><td colSpan={5} className={styles.tfootLabel}>Tax ({taxPercent}%)</td><td>₹{fmt(taxAmount)}</td></tr>
            <tr className={styles.totalRow}><td colSpan={5}><strong>Net Amount</strong></td><td><strong>₹{fmt(netAmount)}</strong></td></tr>
          </tfoot>
        </table>

        <p className={styles.printFooter}>Thank you for choosing City General Hospital.</p>
      </div>

      <div className={styles.previewActions}>
        <button className={styles.printBtn} onClick={handlePrint}>🖨 Print</button>
        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function GenerateBill({ userRole = 'RECEPTIONIST' }) {
  const [patient, setPatient]       = useState(null);
  const [pending, setPending]       = useState(null);
  const [items, setItems]           = useState([]);
  const [taxPercent, setTaxPercent] = useState(5);
  const [notes, setNotes]           = useState('');
  const [preview, setPreview]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdBill, setCreatedBill] = useState(null);
  const [error, setError]           = useState(null);

  // Load pending services when patient selected
  useEffect(() => {
    if (!patient) return;
    fetch(`${API}/bills/pending-services/${patient.id}`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then((r) => r.json())
      .then((json) => setPending(json.data))
      .catch(console.error);
  }, [patient]);

  const addItem = useCallback((preset = {}) => {
    setItems((prev) => [...prev, {
      description: preset.description ?? '',
      category   : preset.category    ?? 'CONSULTATION',
      quantity   : preset.quantity    ?? 1,
      unitPrice  : preset.unitPrice   ?? 0,
      discount   : 0,
      ...preset,
    }]);
  }, []);

  // Auto-load pending services as line items
  const loadPending = useCallback(() => {
    if (!pending) return;
    const newItems = [];
    pending.consultations.forEach((c) => newItems.push({
      description: `Consultation – Dr. ${c.doctor_name} (${c.department ?? ''})`,
      category: 'CONSULTATION', quantity: 1, unitPrice: 500, discount: 0,
    }));
    pending.labOrders.forEach((l) => newItems.push({
      description: `Lab: ${l.test_name}${l.test_code ? ` (${l.test_code})` : ''}`,
      category: 'LAB', quantity: 1, unitPrice: 300, discount: 0,
    }));
    pending.prescriptions.forEach((p) => newItems.push({
      description: `Medicine: ${p.medicine_name} (${p.dosage})`,
      category: 'MEDICINE', quantity: p.quantity, unitPrice: 50, discount: 0,
    }));
    pending.bedCharges.forEach((b) => newItems.push({
      description: `Room charge – ${b.room_type} (${b.room_number}, Bed ${b.bed_number})`,
      category: 'ROOM', quantity: 1, unitPrice: 1200, discount: 0,
    }));
    setItems(newItems);
  }, [pending]);

  const changeItem = (idx, field, val) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  };

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  // Totals
  const subtotal  = items.reduce((s, it) => s + it.unitPrice * it.quantity * (1 - (it.discount ?? 0) / 100), 0);
  const taxAmount = subtotal * (taxPercent / 100);
  const netAmount = subtotal + taxAmount;

  const handleSubmit = async () => {
    if (!patient) { setError('Select a patient first'); return; }
    if (!items.length) { setError('Add at least one line item'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/bills`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body   : JSON.stringify({ patientId: patient.id, items, taxPercent, notes }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Failed to create bill');
      setCreatedBill(json.data);
      setPreview(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Generate Bill</h1>

      {/* Patient search */}
      <section className={styles.section}>
        <label className={styles.label}>Patient</label>
        {patient ? (
          <div className={styles.patientCard}>
            <span>{patient.first_name} {patient.last_name} — MRN: {patient.mrn}</span>
            <button className={styles.clearBtn} onClick={() => { setPatient(null); setItems([]); setPending(null); }}>
              Change
            </button>
          </div>
        ) : (
          <PatientSearch onSelect={setPatient} />
        )}
      </section>

      {/* Auto-load pending */}
      {pending && (
        <div className={styles.pendingBar}>
          <span>
            {pending.consultations.length + pending.labOrders.length +
             pending.prescriptions.length + pending.bedCharges.length} pending service(s) found
          </span>
          <button className={styles.loadBtn} onClick={loadPending}>Load all</button>
        </div>
      )}

      {/* Line items */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <label className={styles.label}>Line Items</label>
          <button className={styles.addBtn} onClick={() => addItem()}>+ Add Item</button>
        </div>
        {items.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Description</th><th>Category</th><th>Qty</th>
                  <th>Unit Price (₹)</th><th>Discount %</th><th>Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <LineItem key={idx} item={item} idx={idx}
                    onChange={changeItem} onRemove={removeItem} userRole={userRole} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>No items yet. Add manually or load pending services.</p>
        )}
      </section>

      {/* Tax & totals */}
      <section className={styles.totalsSection}>
        <div className={styles.taxRow}>
          <label className={styles.label}>Tax %</label>
          <input className={styles.inputSm} type="number" min="0" max="30" value={taxPercent}
            onChange={(e) => setTaxPercent(+e.target.value)} style={{ width: 80 }}
            aria-label="Tax percent" />
        </div>
        <div className={styles.totalsBox}>
          <div className={styles.totalLine}><span>Subtotal</span><span>₹{fmt(subtotal)}</span></div>
          <div className={styles.totalLine}><span>Tax ({taxPercent}%)</span><span>₹{fmt(taxAmount)}</span></div>
          <div className={`${styles.totalLine} ${styles.netLine}`}>
            <span>Net Amount</span><span>₹{fmt(netAmount)}</span>
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className={styles.section}>
        <label className={styles.label}>Notes</label>
        <textarea className={styles.textarea} value={notes}
          onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Optional notes…" aria-label="Bill notes" />
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.actions}>
        <button className={styles.previewBtn} onClick={() => setPreview(true)} disabled={!items.length}>
          Preview
        </button>
        <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting || !patient || !items.length}>
          {submitting ? 'Generating…' : 'Generate Bill'}
        </button>
      </div>

      {preview && (
        <PrintPreview
          bill={createdBill}
          patient={patient ?? {}}
          items={items}
          subtotal={subtotal}
          taxAmount={taxAmount}
          netAmount={netAmount}
          taxPercent={taxPercent}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
