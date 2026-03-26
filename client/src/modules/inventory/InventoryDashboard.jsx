import { useState, useEffect, useCallback } from 'react';
import BedMatrix    from './BedMatrix.jsx';
import QRScanner    from './QRScanner.jsx';
import GenerateQR   from './GenerateQR.jsx';
import styles       from './InventoryDashboard.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const TABS     = ['Medicines', 'Equipment', 'Beds', 'Rooms'];
const CATEGORIES = ['MEDICINE', 'EQUIPMENT', 'CONSUMABLE', 'LINEN', 'CHEMICAL', 'OTHER'];

function authHeaders() {
  return { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` };
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`${styles.statCard} ${accent ? styles[accent] : ''}`}>
      <div className={styles.statValue}>{value ?? '—'}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item row
// ---------------------------------------------------------------------------
function ItemRow({ item, onEdit, onDelete }) {
  const isLow = parseFloat(item.quantity_in_stock) <= parseFloat(item.reorder_level);
  return (
    <tr className={isLow ? styles.lowRow : ''}>
      <td>{item.name}</td>
      <td><code className={styles.sku}>{item.sku}</code></td>
      <td>{item.category}</td>
      <td>{item.department_name ?? '—'}</td>
      <td className={isLow ? styles.lowQty : ''}>
        {item.quantity_in_stock} {item.unit}
        {isLow && <span className={styles.lowBadge}>Low</span>}
      </td>
      <td>{item.reorder_level} {item.unit}</td>
      <td>{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('en-GB') : '—'}</td>
      <td>
        <div className={styles.rowActions}>
          <button className={styles.editBtn}   onClick={() => onEdit(item)}>Edit</button>
          <button className={styles.deleteBtn} onClick={() => onDelete(item.id)}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Item form modal
// ---------------------------------------------------------------------------
function ItemModal({ item, onSave, onClose }) {
  const isEdit = !!item?.id;
  const [form, setForm] = useState({
    name: '', sku: '', category: 'MEDICINE', unit: 'pcs',
    quantityInStock: 0, reorderLevel: 0, unitCost: '',
    expiryDate: '', supplier: '', location: '',
    ...item,
    quantityInStock: item?.quantity_in_stock ?? 0,
    reorderLevel   : item?.reorder_level    ?? 0,
    unitCost       : item?.unit_cost        ?? '',
    expiryDate     : item?.expiry_date      ? item.expiry_date.split('T')[0] : '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  function handleChange(e) {
    const { name, value, type } = e.target;
    setForm((p) => ({ ...p, [name]: type === 'number' ? parseFloat(value) || 0 : value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url    = isEdit ? `${API_BASE}/inventory/${item.id}` : `${API_BASE}/inventory`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res    = await fetch(url, {
        method,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          ...form,
          unitCost  : form.unitCost   ? parseFloat(form.unitCost)   : undefined,
          expiryDate: form.expiryDate || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      onSave(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3>{isEdit ? 'Edit Item' : 'Add Item'}</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <label>Name *<input name="name" value={form.name} onChange={handleChange} required /></label>
            <label>SKU *<input name="sku" value={form.sku} onChange={handleChange} required disabled={isEdit} /></label>
            <label>Category *
              <select name="category" value={form.category} onChange={handleChange}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Unit *<input name="unit" value={form.unit} onChange={handleChange} required /></label>
            <label>Qty in Stock<input name="quantityInStock" type="number" min="0" step="0.001" value={form.quantityInStock} onChange={handleChange} /></label>
            <label>Reorder Level<input name="reorderLevel" type="number" min="0" step="0.001" value={form.reorderLevel} onChange={handleChange} /></label>
            <label>Unit Cost<input name="unitCost" type="number" min="0" step="0.01" value={form.unitCost} onChange={handleChange} /></label>
            <label>Expiry Date<input name="expiryDate" type="date" value={form.expiryDate} onChange={handleChange} /></label>
            <label>Supplier<input name="supplier" value={form.supplier} onChange={handleChange} /></label>
            <label>Location<input name="location" value={form.location} onChange={handleChange} /></label>
          </div>
          {error && <div className={styles.formError}>{error}</div>}
          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV import panel
// ---------------------------------------------------------------------------
function CsvImport({ onDone }) {
  const [file,    setFile]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch(`${API_BASE}/inventory/import`, {
        method : 'POST',
        headers: authHeaders(),
        body   : fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed');
      setResult(json.data);
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.csvPanel}>
      <h4>Bulk Import (CSV)</h4>
      <p className={styles.csvHint}>
        Required columns: <code>name, sku, category, unit</code><br />
        Optional: <code>quantity_in_stock, reorder_level, unit_cost, expiry_date, supplier, location</code>
      </p>
      <div className={styles.csvRow}>
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
        <button className={styles.importBtn} onClick={handleImport} disabled={!file || loading}>
          {loading ? 'Importing…' : 'Import'}
        </button>
      </div>
      {error  && <div className={styles.formError}>{error}</div>}
      {result && (
        <div className={styles.importResult}>
          ✅ {result.created} created/updated · {result.skipped} skipped
          {result.errors?.length > 0 && (
            <details>
              <summary>{result.errors.length} errors</summary>
              <ul>{result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------
export default function InventoryDashboard({ currentUser }) {
  const [activeTab,  setActiveTab]  = useState('Medicines');
  const [stats,      setStats]      = useState(null);
  const [items,      setItems]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [lowOnly,    setLowOnly]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [editItem,   setEditItem]   = useState(null);  // null | {} | item
  const [showImport, setShowImport] = useState(false);
  const [showQrScan, setShowQrScan] = useState(false);
  const [showGenQr,  setShowGenQr]  = useState(false);
  const LIMIT = 20;

  const categoryForTab = { Medicines: 'MEDICINE', Equipment: 'EQUIPMENT' };

  const fetchStats = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/inventory/stats`, { headers: authHeaders() });
    const json = await res.json();
    if (res.ok) setStats(json.data);
  }, []);

  const fetchItems = useCallback(async () => {
    const cat = categoryForTab[activeTab];
    if (!cat) return;
    setLoading(true);
    const params = new URLSearchParams({
      page, limit: LIMIT,
      ...(cat    && { category: cat }),
      ...(search && { search }),
      ...(lowOnly && { lowStock: 'true' }),
    });
    const res  = await fetch(`${API_BASE}/inventory?${params}`, { headers: authHeaders() });
    const json = await res.json();
    if (res.ok) { setItems(json.data.items); setTotal(json.data.total); }
    setLoading(false);
  }, [activeTab, page, search, lowOnly]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { setPage(1); }, [activeTab, search, lowOnly]);
  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function handleDelete(id) {
    if (!confirm('Delete this item?')) return;
    await fetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE', headers: authHeaders() });
    fetchItems();
    fetchStats();
  }

  function handleSaved() {
    setEditItem(null);
    fetchItems();
    fetchStats();
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Inventory</h1>
        <div className={styles.headerActions}>
          <button className={styles.actionBtn} onClick={() => setShowQrScan(true)}>📷 Scan QR</button>
          <button className={styles.actionBtn} onClick={() => setShowGenQr(true)}>🔲 Generate QR</button>
          <button className={styles.actionBtn} onClick={() => setShowImport((v) => !v)}>📥 Import CSV</button>
          <button className={styles.primaryBtn} onClick={() => setEditItem({})}>+ Add Item</button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className={styles.statsRow}>
          <StatCard label="Medicines"      value={stats.totalMedicines} accent="blue" />
          <StatCard label="Equipment"      value={stats.totalEquipment} accent="purple" />
          <StatCard label="Beds Available" value={`${stats.bedsAvailable} / ${stats.bedsTotal}`} accent="green" />
          <StatCard label="Low Stock"      value={stats.lowStockCount}  accent={stats.lowStockCount > 0 ? 'red' : 'green'} />
        </div>
      )}

      {/* CSV import */}
      {showImport && <CsvImport onDone={() => { fetchItems(); fetchStats(); }} />}

      {/* Tabs */}
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            className={`${styles.tab} ${activeTab === t ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Beds tab */}
      {activeTab === 'Beds' && <BedMatrix />}

      {/* Rooms tab — simple room list */}
      {activeTab === 'Rooms' && <BedMatrix roomsOnly />}

      {/* Medicines / Equipment tabs */}
      {(activeTab === 'Medicines' || activeTab === 'Equipment') && (
        <div className={styles.tableSection}>
          <div className={styles.tableToolbar}>
            <input
              className={styles.searchInput}
              placeholder="Search by name or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Low stock only
            </label>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th><th>SKU</th><th>Category</th><th>Department</th>
                  <th>Stock</th><th>Reorder</th><th>Expiry</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className={styles.loadingCell}>Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={8} className={styles.emptyCell}>No items found</td></tr>
                ) : (
                  items.map((item) => (
                    <ItemRow key={item.id} item={item} onEdit={setEditItem} onDelete={handleDelete} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button disabled={page === 1}          onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {editItem !== null && (
        <ItemModal item={editItem.id ? editItem : null} onSave={handleSaved} onClose={() => setEditItem(null)} />
      )}
      {showQrScan && <QRScanner onClose={() => setShowQrScan(false)} />}
      {showGenQr  && <GenerateQR onClose={() => setShowGenQr(false)} />}
    </div>
  );
}
