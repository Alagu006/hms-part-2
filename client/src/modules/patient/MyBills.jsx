import { useState, useEffect, useCallback } from 'react';
import styles from './MyBills.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';
// Razorpay test key — replace with your actual test key from dashboard.razorpay.com
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID ?? 'rzp_test_XXXXXXXXXX';

const token = () => sessionStorage.getItem('accessToken');

function fmt(n) { return Number(n ?? 0).toFixed(2); }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

const STATUS_CFG = {
  ISSUED        : { label: 'Pending',  cls: 'badgePending'  },
  PARTIALLY_PAID: { label: 'Partial',  cls: 'badgePartial'  },
  PAID          : { label: 'Paid',     cls: 'badgePaid'     },
  REFUNDED      : { label: 'Refunded', cls: 'badgeRefunded' },
  DRAFT         : { label: 'Draft',    cls: 'badgeDraft'    },
  CANCELLED     : { label: 'Cancelled',cls: 'badgeDraft'    },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.DRAFT;
  return <span className={`${styles.badge} ${styles[cfg.cls]}`}>{cfg.label}</span>;
}

// ---------------------------------------------------------------------------
// Load Razorpay script lazily
// ---------------------------------------------------------------------------
function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// ---------------------------------------------------------------------------
// Receipt PDF (simple print-based)
// ---------------------------------------------------------------------------
function printReceipt(bill) {
  const items = (bill.items ?? []).map((it) =>
    `<tr><td>${it.description}</td><td>${it.item_type}</td><td>${it.quantity}</td>
     <td>₹${fmt(it.unit_price)}</td><td>${it.discount_pct}%</td><td>₹${fmt(it.total_price)}</td></tr>`
  ).join('');

  const payments = (bill.payments ?? []).map((p) =>
    `<tr><td>${fmtDate(p.processed_at)}</td><td>${p.method}</td><td>₹${fmt(p.amount)}</td><td>${p.reference_no ?? '—'}</td></tr>`
  ).join('');

  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Receipt – ${bill.bill_number}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
      h1 { text-align: center; font-size: 1.4rem; color: #1e3a5f; }
      p.sub { text-align: center; font-size: .8rem; color: #666; }
      hr { border-top: 2px solid #1e3a5f; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: .85rem; }
      th, td { border: 1px solid #ddd; padding: 6px 10px; }
      th { background: #f9fafb; }
      .total { font-weight: 700; font-size: 1rem; }
      @media print { button { display: none; } }
    </style></head><body>
    <h1>City General Hospital</h1>
    <p class="sub">123 Medical Lane · Tel: +91-XXXXXXXXXX</p>
    <hr/>
    <h2 style="text-align:center">PAYMENT RECEIPT</h2>
    <p><strong>Bill #:</strong> ${bill.bill_number} &nbsp;&nbsp; <strong>Date:</strong> ${fmtDate(bill.issued_at)}</p>
    <p><strong>Patient:</strong> ${bill.patient_name ?? ''} &nbsp;&nbsp; <strong>MRN:</strong> ${bill.mrn ?? ''}</p>
    <table>
      <thead><tr><th>Description</th><th>Type</th><th>Qty</th><th>Unit Price</th><th>Disc</th><th>Total</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
    <p class="total" style="text-align:right">Net Amount: ₹${fmt(bill.net_amount)}</p>
    <h3>Payments</h3>
    <table>
      <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Reference</th></tr></thead>
      <tbody>${payments}</tbody>
    </table>
    <p style="text-align:center;font-size:.75rem;color:#999;margin-top:32px">Thank you for choosing City General Hospital.</p>
    <button onclick="window.print()">Print</button>
    </body></html>
  `);
  w.document.close();
  w.focus();
  w.print();
}

// ---------------------------------------------------------------------------
// Pay Now — Razorpay checkout
// ---------------------------------------------------------------------------
async function initiateRazorpay({ bill, onSuccess, onError }) {
  const loaded = await loadRazorpay();
  if (!loaded) { onError('Failed to load Razorpay. Check your connection.'); return; }

  // Calculate outstanding
  const paid = (bill.payments ?? [])
    .filter((p) => p.status === 'COMPLETED' && p.method !== 'REFUND')
    .reduce((s, p) => s + +p.amount, 0);
  const outstanding = Math.max(0, +bill.net_amount - paid);

  const options = {
    key        : RAZORPAY_KEY_ID,
    amount     : Math.round(outstanding * 100), // paise
    currency   : 'INR',
    name       : 'City General Hospital',
    description: `Bill ${bill.bill_number}`,
    image      : '/logo.png',
    prefill    : { name: bill.patient_name ?? '', email: '', contact: '' },
    notes      : { bill_id: bill.id, bill_number: bill.bill_number },
    theme      : { color: '#1e3a5f' },
    handler    : async (response) => {
      // Record payment on server
      try {
        const r = await fetch(`${API}/bills/${bill.id}/pay`, {
          method : 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body   : JSON.stringify({
            amount              : outstanding,
            paymentMethod       : 'ONLINE',
            razorpayOrderId     : response.razorpay_order_id,
            razorpayPaymentId   : response.razorpay_payment_id,
          }),
        });
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? 'Payment recording failed');
        onSuccess(json.data);
      } catch (e) { onError(e.message); }
    },
    modal: { ondismiss: () => {} },
  };

  const rzp = new window.Razorpay(options);
  rzp.on('payment.failed', (resp) => onError(resp.error.description));
  rzp.open();
}

// ---------------------------------------------------------------------------
// Bill detail panel
// ---------------------------------------------------------------------------
function BillDetail({ bill, onClose, onPaySuccess }) {
  const [paying, setPaying]   = useState(false);
  const [payError, setPayError] = useState(null);

  const handlePay = async () => {
    setPaying(true);
    setPayError(null);
    await initiateRazorpay({
      bill,
      onSuccess: (data) => { setPaying(false); onPaySuccess(data); },
      onError  : (msg)  => { setPaying(false); setPayError(msg); },
    });
    setPaying(false);
  };

  const paid = (bill.payments ?? [])
    .filter((p) => p.status === 'COMPLETED' && p.method !== 'REFUND')
    .reduce((s, p) => s + +p.amount, 0);
  const outstanding = Math.max(0, +bill.net_amount - paid);
  const canPay = ['ISSUED','PARTIALLY_PAID'].includes(bill.status) && outstanding > 0;

  return (
    <div className={styles.detailOverlay} role="dialog" aria-modal="true" aria-label="Bill detail">
      <div className={styles.detailBox}>
        <div className={styles.detailHeader}>
          <div>
            <h2 className={styles.detailTitle}>{bill.bill_number}</h2>
            <p className={styles.detailMeta}>{fmtDate(bill.issued_at)} · {bill.patient_name}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <StatusBadge status={bill.status} />
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* Items */}
        <table className={styles.detailTable}>
          <thead>
            <tr><th>Description</th><th>Type</th><th>Qty</th><th>Unit</th><th>Disc</th><th>Total</th></tr>
          </thead>
          <tbody>
            {(bill.items ?? []).map((it) => (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td>{it.item_type}</td>
                <td>{it.quantity}</td>
                <td>₹{fmt(it.unit_price)}</td>
                <td>{it.discount_pct}%</td>
                <td>₹{fmt(it.total_price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className={styles.tfootLabel}>Net Amount</td><td><strong>₹{fmt(bill.net_amount)}</strong></td></tr>
            <tr><td colSpan={5} className={styles.tfootLabel}>Paid</td><td className={styles.paidAmt}>₹{fmt(paid)}</td></tr>
            {outstanding > 0 && (
              <tr><td colSpan={5} className={styles.tfootLabel}>Outstanding</td><td className={styles.outstandingAmt}>₹{fmt(outstanding)}</td></tr>
            )}
          </tfoot>
        </table>

        {/* Payments */}
        {(bill.payments ?? []).length > 0 && (
          <>
            <h3 className={styles.subTitle}>Payment History</h3>
            <table className={styles.detailTable}>
              <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Reference</th></tr></thead>
              <tbody>
                {bill.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.processed_at)}</td>
                    <td>{p.method}</td>
                    <td>₹{fmt(p.amount)}</td>
                    <td>{p.reference_no ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {payError && <p className={styles.error} role="alert">{payError}</p>}

        <div className={styles.detailActions}>
          {canPay && (
            <button className={styles.payBtn} onClick={handlePay} disabled={paying}>
              {paying ? 'Processing…' : `Pay ₹${fmt(outstanding)} via Razorpay`}
            </button>
          )}
          <button className={styles.receiptBtn} onClick={() => printReceipt(bill)}>
            ⬇ Download Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function MyBills({ patientId }) {
  const [bills, setBills]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [error, setError]     = useState(null);

  const fetchBills = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/bills/patient/${patientId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Failed to load bills');
      setBills(json.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const handlePaySuccess = (data) => {
    // Refresh bills after payment
    fetchBills();
    setSelected(null);
  };

  if (loading) return <div className={styles.loading}>Loading bills…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>My Bills</h1>

      {bills.length === 0 ? (
        <p className={styles.empty}>No bills found.</p>
      ) : (
        <div className={styles.list}>
          {bills.map((bill) => {
            const paid = (bill.payments ?? [])
              .filter((p) => p.status === 'COMPLETED' && p.method !== 'REFUND')
              .reduce((s, p) => s + +p.amount, 0);
            const outstanding = Math.max(0, +bill.net_amount - paid);
            const canPay = ['ISSUED','PARTIALLY_PAID'].includes(bill.status);

            return (
              <div key={bill.id} className={styles.card}>
                <div className={styles.cardLeft}>
                  <p className={styles.billNum}>{bill.bill_number}</p>
                  <p className={styles.billDate}>{fmtDate(bill.issued_at)}</p>
                </div>
                <div className={styles.cardMid}>
                  <p className={styles.amount}>₹{fmt(bill.net_amount)}</p>
                  {outstanding > 0 && canPay && (
                    <p className={styles.outstanding}>Outstanding: ₹{fmt(outstanding)}</p>
                  )}
                </div>
                <div className={styles.cardRight}>
                  <StatusBadge status={bill.status} />
                  <div className={styles.cardActions}>
                    <button className={styles.viewBtn} onClick={() => setSelected(bill)}>View</button>
                    {canPay && (
                      <button className={styles.payNowBtn} onClick={() => setSelected(bill)}>Pay Now</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <BillDetail
          bill={selected}
          onClose={() => setSelected(null)}
          onPaySuccess={handlePaySuccess}
        />
      )}
    </div>
  );
}
