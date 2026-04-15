import { useEffect, useState } from 'react';
import api from '../../shared/utils/api.js';
import styles from './RadiologistDashboard.module.scss';

const inputStyle = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8125rem', width: '100%', boxSizing: 'border-box' };
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', marginBottom: 12 };

export default function RadiologistDashboard() {
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [reportOrder, setReportOrder] = useState(null);
  const [form, setForm]             = useState({ resultText: '', interpretation: '', isAbnormal: false });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  useEffect(() => {
    api.get('/lab-orders', { params: { limit: 50 } })
      .then((r) => setOrders(r.data.labOrders ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const pending   = orders.filter((o) => ['PENDING', 'COLLECTED', 'PROCESSING'].includes(o.status));
  const completed = orders.filter((o) => o.status === 'COMPLETED');

  const updateStatus = async (id, status) => {
    await api.patch(`/lab-orders/${id}`, { status }).catch(() => {});
    setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status } : o));
  };

  const openReport = (order) => {
    setReportOrder(order);
    setForm({ resultText: '', interpretation: '', isAbnormal: false });
    setFormError('');
  };

  const handleSubmitReport = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/lab-orders/results', {
        labOrderId    : reportOrder.id,
        resultText    : form.resultText,
        interpretation: form.interpretation || undefined,
        isAbnormal    : form.isAbnormal,
      });
      // Mark order as completed
      await api.patch(`/lab-orders/${reportOrder.id}`, { status: 'COMPLETED' });
      setOrders((prev) => prev.map((o) => o.id === reportOrder.id ? { ...o, status: 'COMPLETED' } : o));
      setReportOrder(null);
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to submit report');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Radiology Dashboard</h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{pending.length}</span>
          <span className={styles.statLabel}>Pending Orders</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{completed.length}</span>
          <span className={styles.statLabel}>Completed</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{orders.length}</span>
          <span className={styles.statLabel}>Total Orders</span>
        </div>
      </div>

      {/* Report Modal */}
      {reportOrder && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:8,padding:28,width:500,maxWidth:'90vw',maxHeight:'90vh',overflowY:'auto' }}>
            <h2 style={{ margin:'0 0 4px',fontSize:'1rem' }}>Submit Radiology Report</h2>
            <p style={{ margin:'0 0 16px',fontSize:'0.8125rem',color:'#6b7280' }}>
              Patient: <strong>{reportOrder.patient_first_name} {reportOrder.patient_last_name}</strong> · {reportOrder.test_name ?? reportOrder.test_type}
            </p>
            <form onSubmit={handleSubmitReport}>
              <label style={labelStyle}>
                Findings / Report *
                <textarea required value={form.resultText}
                  onChange={(e) => setForm(f => ({ ...f, resultText: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
                  placeholder="Describe imaging findings in detail…" />
              </label>
              <label style={labelStyle}>
                Interpretation / Impression
                <textarea value={form.interpretation}
                  onChange={(e) => setForm(f => ({ ...f, interpretation: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
                  placeholder="Clinical impression or recommendation…" />
              </label>
              <label style={{ display:'flex',alignItems:'center',gap:8,fontSize:'0.8125rem',marginBottom:16,cursor:'pointer' }}>
                <input type="checkbox" checked={form.isAbnormal} onChange={(e) => setForm(f => ({ ...f, isAbnormal: e.target.checked }))} />
                Mark as Abnormal
              </label>
              {formError && <p style={{ color:'#ef4444',fontSize:'0.8rem',margin:'0 0 12px' }}>{formError}</p>}
              <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                <button type="button" onClick={() => setReportOrder(null)} style={{ padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding:'8px 16px',background:'#0891b2',color:'#fff',border:'none',borderRadius:4,cursor:'pointer' }}>
                  {saving ? 'Submitting…' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>Radiology Orders</div>
        <table className={styles.table}>
          <thead>
            <tr><th>Order ID</th><th>Patient</th><th>Test</th><th>Ordered By</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className={styles.mono}>{o.id?.slice(0, 8)}</td>
                <td>{o.patient_first_name} {o.patient_last_name}</td>
                <td>{o.test_name ?? o.test_type ?? '—'}</td>
                <td>{o.ordered_by_name ?? '—'}</td>
                <td>
                  <span className={`${styles.badge} ${styles[`status_${o.status}`] ?? ''}`}>
                    {o.status ?? 'PENDING'}
                  </span>
                </td>
                <td className={styles.actions}>
                  {o.status === 'PENDING' && (
                    <button className={styles.actionBtn} onClick={() => updateStatus(o.id, 'PROCESSING')}>Start</button>
                  )}
                  {o.status === 'PROCESSING' && (
                    <button className={styles.actionBtn} onClick={() => openReport(o)}>Submit Report</button>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={6} className={styles.empty}>No radiology orders.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
