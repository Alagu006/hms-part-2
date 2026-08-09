import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './PharmacistDashboard.module.scss';

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchPendingPrescriptions() {
  const json = await apiFetch(`/prescriptions?status=PENDING&page=1&limit=50`);
  return json?.prescriptions ?? [];
}

async function fetchDispensedToday() {
  const today = new Date().toISOString().split('T')[0];
  const json = await apiFetch(`/prescriptions?status=DISPENSED&page=1&limit=50`);
  return (json?.prescriptions ?? []).filter(p => new Date(p.created_at).toISOString().split('T')[0] === today);
}

async function fetchAllMedicines({ page = 1, search = '' } = {}) {
  const params = new URLSearchParams({ page, limit: 20 });
  if (search) params.set('search', search);
  const json = await apiFetch(`/prescriptions/medicines?${params}`);
  return json?.data ?? { items: [], total: 0 };
}

async function fetchLowStockItems() {
  const json = await apiFetch(`/inventory?category=MEDICINE&lowStock=true&page=1&limit=50`);
  return json?.data?.items ?? [];
}

async function fetchPendingCount() {
  const json = await apiFetch(`/prescriptions?status=PENDING&page=1&limit=1`);
  return json?.total ?? 0;
}

async function fetchDispensedCount() {
  const json = await apiFetch(`/prescriptions?status=DISPENSED&page=1&limit=1`);
  const today = new Date().toISOString().split('T')[0];
  return (json?.prescriptions ?? []).filter(p => new Date(p.created_at).toISOString().split('T')[0] === today).length;
}

async function fetchLowStockCount() {
  const json = await apiFetch(`/inventory?category=MEDICINE&lowStock=true&page=1&limit=1`);
  return json?.data?.total ?? 0;
}

async function dispensePrescription(id, items) {
  const dispensedItems = items.map((item) => ({ itemId: item.id, dispensed: true }));
  return apiFetch(`/prescriptions/${id}/dispense`, {
    method: 'PATCH',
    body: JSON.stringify({ dispensedItems, notes: '' }),
  });
}

async function addMedicine(data) {
  return apiFetch(`/prescriptions/medicines`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

async function requestRestock(itemId, requestedQty) {
  console.log('Restock request:', { itemId, requestedQty });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function SkeletonCard({ height = 120 }) {
  return <div className={styles.skeleton} style={{ height, borderRadius: 8 }} />;
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
function StatCard({ label, value, alert, loading }) {
  return (
    <div className={`${styles.statCard} ${alert ? styles.statAlert : ''}`}>
      <span className={styles.statLabel}>{label}</span>
      {loading ? (
        <div className={styles.skeleton} style={{ width: 48, height: 32, marginTop: 6 }} />
      ) : (
        <span className={styles.statValue}>{value}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prescription Card
// ---------------------------------------------------------------------------
function PrescriptionCard({ prescription, onDispense }) {
  const patientName = `${prescription.patient_first} ${prescription.patient_last}`;
  const doctorName = `${prescription.doctor_first} ${prescription.doctor_last}`;
  const createdTime = prescription.created_at
    ? new Date(prescription.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={styles.prescriptionCard}>
      <div className={styles.cardHeader}>
        <div className={styles.patientInfo}>
          <span className={styles.patientName}>{patientName}</span>
          <span className={styles.patientId}>ID: {prescription.patient_mrn}</span>
        </div>
      </div>
      <div className={styles.cardMeta}>
        <span className={styles.metaItem}><strong>Dr. {doctorName}</strong></span>
        <span className={styles.metaTime}>{createdTime}</span>
      </div>
      <div className={styles.medicinesList}>
        <span className={styles.medicinesLabel}>{prescription.item_count} medicine(s)</span>
      </div>
      <button className={styles.dispenseBtn} onClick={() => onDispense(prescription, patientName)}>
        Dispense
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispensed Table Row
// ---------------------------------------------------------------------------
function DispensedRow({ prescription }) {
  const patientName = `${prescription.patient_first} ${prescription.patient_last}`;
  const doctorName = `${prescription.doctor_first} ${prescription.doctor_last}`;
  const dispensedTime = prescription.updated_at
    ? new Date(prescription.updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <tr className={styles.dispensedRow}>
      <td>{patientName}</td>
      <td>Dr. {doctorName}</td>
      <td>{prescription.item_count}</td>
      <td>{dispensedTime}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Low Stock Row
// ---------------------------------------------------------------------------
function LowStockRow({ item, onRestock }) {
  const [requestedQty, setRequestedQty] = useState(item.reorder_level * 2 || 10);
  const [isRequesting, setIsRequesting] = useState(false);

  const handleRestock = async () => {
    setIsRequesting(true);
    try { await onRestock(item.id, requestedQty); }
    catch { alert('Failed to submit restock request'); }
    finally { setIsRequesting(false); }
  };

  const pct = item.reorder_level > 0
    ? Math.min(100, Math.round((item.quantity_in_stock / item.reorder_level) * 100))
    : 100;

  return (
    <tr className={styles.lowStockRow}>
      <td>
        <span className={styles.warningIcon}>⚠</span>
        <span>{item.name}</span>
        <div className={styles.stockBar}>
          <div className={styles.stockBarFill} style={{ width: `${pct}%` }} />
        </div>
      </td>
      <td>{item.quantity_in_stock} {item.unit}</td>
      <td>{item.reorder_level} {item.unit}</td>
      <td>
        <div className={styles.restockAction}>
          <input
            type="number" min="1" value={requestedQty}
            onChange={(e) => setRequestedQty(parseInt(e.target.value) || 1)}
            className={styles.restockInput}
          />
          <button className={styles.restockBtn} onClick={handleRestock} disabled={isRequesting}>
            {isRequesting ? '...' : 'Request'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Add Medicine Modal
// ---------------------------------------------------------------------------
const EMPTY_FORM = {
  name: '', genericName: '', form: 'TABLET', strength: '', category: 'GENERAL',
};

const MEDICINE_FORMS = ['TABLET','CAPSULE','SYRUP','INJECTION','CREAM','DROPS','INHALER','PATCH','OTHER'];
const MEDICINE_CATEGORIES = ['GENERAL','ANTIBIOTIC','ANALGESIC','ANTIVIRAL','ANTIFUNGAL','CARDIOVASCULAR','NEUROLOGICAL','OTHER'];

function AddMedicineModal({ isOpen, onClose, onSave, isSaving }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    return e;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    onSave({
      name: form.name.trim(),
      genericName: form.genericName.trim() || undefined,
      form: form.form,
      strength: form.strength.trim() || undefined,
      category: form.category,
    });
  };

  const handleClose = () => { setForm(EMPTY_FORM); setErrors({}); onClose(); };

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div className={styles.modalContent} style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Add Medicine</h3>
        <form onSubmit={handleSubmit} className={styles.addForm}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Name *</label>
              <input value={form.name} onChange={set('name')} placeholder="e.g. Paracetamol" />
              {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
            </div>
            <div className={styles.formGroup}>
              <label>Generic Name</label>
              <input value={form.genericName} onChange={set('genericName')} placeholder="e.g. Acetaminophen" />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Form</label>
              <select value={form.form} onChange={set('form')}>
                {MEDICINE_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Strength</label>
              <input value={form.strength} onChange={set('strength')} placeholder="e.g. 500mg" />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>Category</label>
            <select value={form.category} onChange={set('category')}>
              {MEDICINE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className={styles.modalActions}>
            <button type="button" className={styles.cancelBtn} onClick={handleClose}>Cancel</button>
            <button type="submit" className={styles.confirmBtn} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Add Medicine'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation Modal
// ---------------------------------------------------------------------------
function ConfirmationModal({ isOpen, patientName, medicineCount, onConfirm, onCancel }) {
  if (!isOpen) return null;
  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Confirm Dispensing</h3>
        <p className={styles.modalMessage}>
          Confirm dispensing {medicineCount} medicine(s) for <strong>{patientName}</strong>?
        </p>
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button className={styles.confirmBtn} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`${styles.toast} ${type === 'success' ? styles.toastSuccess : styles.toastError}`}>
      <span>{message}</span>
      <button className={styles.toastClose} onClick={onClose}>×</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function PharmacistDashboard() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState({ message: '', type: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [addMedicineOpen, setAddMedicineOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('prescriptions'); // 'prescriptions' | 'medicines' | 'lowstock'
  const [medicineSearch, setMedicineSearch] = useState('');
  const [medicinePage, setMedicinePage] = useState(1);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 3000);
  };

  // Queries
  const { data: pendingPrescriptions = [], isLoading: pendingLoading, isError: pendingError } = useQuery({
    queryKey: ['pharmacy-pending'],
    queryFn: fetchPendingPrescriptions,
    refetchInterval: 30_000,
  });

  const { data: dispensedToday = [], isLoading: dispensedLoading, isError: dispensedError } = useQuery({
    queryKey: ['pharmacy-dispensed-today'],
    queryFn: fetchDispensedToday,
    refetchInterval: 30_000,
  });

  const { data: lowStockItems = [], isLoading: lowStockLoading, isError: lowStockError } = useQuery({
    queryKey: ['pharmacy-low-stock'],
    queryFn: fetchLowStockItems,
    refetchInterval: 60_000,
  });

  const { data: medicinesData, isLoading: medicinesLoading } = useQuery({
    queryKey: ['pharmacy-medicines', medicinePage, medicineSearch],
    queryFn: () => fetchAllMedicines({ page: medicinePage, search: medicineSearch }),
    enabled: activeTab === 'medicines',
    keepPreviousData: true,
  });

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['pharmacy-pending-count'],
    queryFn: fetchPendingCount,
    refetchInterval: 30_000,
  });

  const { data: dispensedCount = 0 } = useQuery({
    queryKey: ['pharmacy-dispensed-count'],
    queryFn: fetchDispensedCount,
    refetchInterval: 30_000,
  });

  const { data: lowStockCount = 0 } = useQuery({
    queryKey: ['pharmacy-low-stock-count'],
    queryFn: fetchLowStockCount,
    refetchInterval: 60_000,
  });

  // Mutations
  const dispenseMutation = useMutation({
    mutationFn: ({ id, items }) => dispensePrescription(id, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-pending'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-dispensed-today'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-dispensed-count'] });
      showToast('Prescription dispensed successfully!');
    },
    onError: () => showToast('Failed to dispense prescription', 'error'),
  });

  const addMedicineMutation = useMutation({
    mutationFn: addMedicine,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-medicines'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-low-stock-count'] });
      setAddMedicineOpen(false);
      showToast('Medicine added successfully!');
    },
    onError: (e) => showToast(e.message || 'Failed to add medicine', 'error'),
  });

  const restockMutation = useMutation({
    mutationFn: ({ itemId, requestedQty }) => requestRestock(itemId, requestedQty),
    onSuccess: () => showToast('Restock request submitted!'),
    onError: () => showToast('Failed to submit restock request', 'error'),
  });

  const handleDispenseClick = (prescription, patientName) => {
    setSelectedPrescription({ prescription, patientName });
    setModalOpen(true);
  };

  const handleConfirmDispense = () => {
    if (selectedPrescription) {
      const { prescription } = selectedPrescription;
      const items = Array(prescription.item_count).fill({ id: 'dummy' });
      dispenseMutation.mutate({ id: prescription.id, items });
    }
    setModalOpen(false);
    setSelectedPrescription(null);
  };

  const medicines = medicinesData?.items ?? [];
  const medicinesTotal = medicinesData?.total ?? 0;
  const totalPages = Math.ceil(medicinesTotal / 20);

  return (
    <div className={styles.page}>
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: '' })} />

      <ConfirmationModal
        isOpen={modalOpen}
        patientName={selectedPrescription?.patientName}
        medicineCount={selectedPrescription?.prescription?.item_count}
        onConfirm={handleConfirmDispense}
        onCancel={() => { setModalOpen(false); setSelectedPrescription(null); }}
      />

      <AddMedicineModal
        isOpen={addMedicineOpen}
        onClose={() => setAddMedicineOpen(false)}
        onSave={(data) => addMedicineMutation.mutate(data)}
        isSaving={addMedicineMutation.isPending}
      />

      {/* Stats */}
      <div className={styles.statsRow}>
        <StatCard label="Pending Prescriptions" value={pendingCount} alert={pendingCount > 0} loading={pendingLoading} />
        <StatCard label="Dispensed Today" value={dispensedCount} loading={dispensedLoading} />
        <StatCard label="Low Stock Alerts" value={lowStockCount} alert={lowStockCount > 0} loading={lowStockLoading} />
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === 'prescriptions' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('prescriptions')}
        >
          Prescriptions
          {pendingPrescriptions.length > 0 && (
            <span className={styles.tabBadge}>{pendingPrescriptions.length}</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'medicines' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('medicines')}
        >
          Medicines
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'lowstock' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('lowstock')}
        >
          Low Stock
          {lowStockCount > 0 && (
            <span className={`${styles.tabBadge} ${styles.tabBadgeAlert}`}>{lowStockCount}</span>
          )}
        </button>
      </div>

      {/* ── Prescriptions Tab ── */}
      {activeTab === 'prescriptions' && (
        <div className={styles.twoCol}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Pending Prescriptions</h2>
              <span className={styles.badge}>{pendingPrescriptions.length}</span>
            </div>
            {pendingLoading ? (
              <div className={styles.cardList}><SkeletonCard height={140} /><SkeletonCard height={140} /></div>
            ) : pendingError ? (
              <div className={styles.errorState}>Failed to load prescriptions.</div>
            ) : pendingPrescriptions.length === 0 ? (
              <div className={styles.emptyState}>No pending prescriptions.</div>
            ) : (
              <div className={styles.cardList}>
                {pendingPrescriptions.map((p) => (
                  <PrescriptionCard key={p.id} prescription={p} onDispense={handleDispenseClick} />
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Dispensed Today</h2>
              <span className={styles.badge}>{dispensedToday.length}</span>
            </div>
            {dispensedLoading ? (
              <div className={styles.tableLoading}><SkeletonCard height={200} /></div>
            ) : dispensedError ? (
              <div className={styles.errorState}>Failed to load dispensed prescriptions.</div>
            ) : dispensedToday.length === 0 ? (
              <div className={styles.emptyState}>No prescriptions dispensed today.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.dispensedTable}>
                  <thead>
                    <tr><th>Patient</th><th>Doctor</th><th>Medicines</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {dispensedToday.map((p) => <DispensedRow key={p.id} prescription={p} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Medicines Tab ── */}
      {activeTab === 'medicines' && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Medicine Inventory</h2>
            <div className={styles.sectionActions}>
              <input
                className={styles.searchInput}
                placeholder="Search medicines..."
                value={medicineSearch}
                onChange={(e) => { setMedicineSearch(e.target.value); setMedicinePage(1); }}
              />
              <button className={styles.addBtn} onClick={() => setAddMedicineOpen(true)}>
                + Add Medicine
              </button>
            </div>
          </div>
          {medicinesLoading ? (
            <div className={styles.tableLoading}><SkeletonCard height={200} /></div>
          ) : medicines.length === 0 ? (
            <div className={styles.emptyState}>No medicines found.</div>
          ) : (
            <>
              <div className={styles.tableWrapper}>
                <table className={styles.dispensedTable}>
                  <thead>
                    <tr>
                      <th>Name</th><th>Generic Name</th><th>Form</th>
                      <th>Strength</th><th>Category</th><th>Controlled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medicines.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.generic_name || '—'}</td>
                        <td>{m.form || '—'}</td>
                        <td>{m.strength || '—'}</td>
                        <td>{m.category || '—'}</td>
                        <td>{m.is_controlled ? <span className={styles.stockLow}>Yes</span> : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button disabled={medicinePage === 1} onClick={() => setMedicinePage((p) => p - 1)}>← Prev</button>
                  <span>Page {medicinePage} of {totalPages}</span>
                  <button disabled={medicinePage >= totalPages} onClick={() => setMedicinePage((p) => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Low Stock Tab ── */}
      {activeTab === 'lowstock' && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Low Stock Medicines</h2>
            <span className={`${styles.badge} ${lowStockCount > 0 ? styles.badgeAlert : ''}`}>
              {lowStockCount}
            </span>
          </div>
          {lowStockLoading ? (
            <div className={styles.tableLoading}><SkeletonCard height={200} /></div>
          ) : lowStockError ? (
            <div className={styles.errorState}>Failed to load low stock items.</div>
          ) : lowStockItems.length === 0 ? (
            <div className={styles.emptyState}>✓ All medicines are sufficiently stocked.</div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.lowStockTable}>
                <thead>
                  <tr><th>Medicine</th><th>Current</th><th>Reorder Level</th><th>Request Restock</th></tr>
                </thead>
                <tbody>
                  {lowStockItems.map((item) => (
                    <LowStockRow
                      key={item.id}
                      item={item}
                      onRestock={(itemId, qty) => restockMutation.mutate({ itemId, requestedQty: qty })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
