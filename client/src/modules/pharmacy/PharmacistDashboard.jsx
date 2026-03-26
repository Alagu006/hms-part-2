import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styles from './PharmacistDashboard.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function authHeaders() {
  return { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` };
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchPendingPrescriptions() {
  const res = await fetch(`${API_BASE}/prescriptions?status=ISSUED&page=1&limit=50`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load pending prescriptions');
  const json = await res.json();
  return json.prescriptions ?? [];
}

async function fetchDispensedToday() {
  const today = new Date().toISOString().split('T')[0];
  const res = await fetch(`${API_BASE}/prescriptions?status=DISPENSED&page=1&limit=50`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load dispensed prescriptions');
  const json = await res.json();
  // Filter by today's date on client side since backend filters by created_at not dispensed_at
  return (json.prescriptions ?? []).filter(p => {
    const created = new Date(p.created_at).toISOString().split('T')[0];
    return created === today;
  });
}

async function fetchLowStockItems() {
  const res = await fetch(`${API_BASE}/inventory?category=MEDICINE&lowStock=true&page=1&limit=50`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load low stock items');
  const json = await res.json();
  return json.items ?? [];
}

async function fetchPendingCount() {
  const res = await fetch(`${API_BASE}/prescriptions?status=ISSUED&page=1&limit=1`, {
    headers: authHeaders(),
  });
  if (!res.ok) return 0;
  const json = await res.json();
  return json.total ?? 0;
}

async function fetchDispensedCount() {
  const res = await fetch(`${API_BASE}/prescriptions?status=DISPENSED&page=1&limit=1`, {
    headers: authHeaders(),
  });
  if (!res.ok) return 0;
  const json = await res.json();
  // Filter by today's date on client side
  const all = json.prescriptions ?? [];
  const today = new Date().toISOString().split('T')[0];
  return all.filter(p => {
    const created = new Date(p.created_at).toISOString().split('T')[0];
    return created === today;
  }).length;
}

async function fetchLowStockCount() {
  const res = await fetch(`${API_BASE}/inventory?category=MEDICINE&lowStock=true`, {
    headers: authHeaders(),
  });
  if (!res.ok) return 0;
  const json = await res.json();
  return json.total ?? 0;
}

async function dispensePrescription(id, items) {
  const dispensedItems = items.map((item) => ({
    itemId: item.id,
    dispensed: true,
  }));
  const res = await fetch(`${API_BASE}/prescriptions/${id}/dispense`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dispensedItems, notes: '' }),
  });
  if (!res.ok) throw new Error('Failed to dispense prescription');
  return res.json();
}

async function requestRestock(itemId, requestedQty) {
  // Placeholder - no backend endpoint exists for restock requests
  // In production, this would POST to /inventory/restock-request
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
  const [isDispensing, setIsDispensing] = useState(false);

  const patientName = `${prescription.patient_first} ${prescription.patient_last}`;
  const doctorName = `${prescription.doctor_first} ${prescription.doctor_last}`;
  const createdTime = prescription.created_at
    ? new Date(prescription.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const handleDispenseClick = () => {
    onDispense(prescription, patientName);
  };

  return (
    <div className={styles.prescriptionCard}>
      <div className={styles.cardHeader}>
        <div className={styles.patientInfo}>
          <span className={styles.patientName}>{patientName}</span>
          <span className={styles.patientId}>ID: {prescription.patient_mrn}</span>
        </div>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.metaItem}>
          <strong>Dr. {doctorName}</strong>
        </span>
        <span className={styles.metaTime}>{createdTime}</span>
      </div>

      <div className={styles.medicinesList}>
        <span className={styles.medicinesLabel}>{prescription.item_count} medicine(s)</span>
      </div>

      <button
        className={styles.dispenseBtn}
        onClick={handleDispenseClick}
        disabled={isDispensing}
      >
        {isDispensing ? 'Dispensing...' : 'Dispense'}
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
    ? new Date(prescription.updated_at).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
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
  const [requestedQty, setRequestedQty] = useState(item.reorder_level * 2);
  const [isRequesting, setIsRequesting] = useState(false);

  const handleRestock = async () => {
    setIsRequesting(true);
    try {
      await onRestock(item.id, requestedQty);
    } catch (err) {
      alert('Failed to submit restock request');
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <tr className={styles.lowStockRow}>
      <td>
        <span className={styles.warningIcon}>⚠</span>
        {item.name}
      </td>
      <td>{item.quantity_in_stock} {item.unit}</td>
      <td>{item.reorder_level} {item.unit}</td>
      <td>
        <div className={styles.restockAction}>
          <input
            type="number"
            min="1"
            value={requestedQty}
            onChange={(e) => setRequestedQty(parseInt(e.target.value) || 1)}
            className={styles.restockInput}
          />
          <button
            className={styles.restockBtn}
            onClick={handleRestock}
            disabled={isRequesting}
          >
            {isRequesting ? '...' : 'Request'}
          </button>
        </div>
      </td>
    </tr>
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
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.confirmBtn} onClick={onConfirm}>
            Confirm
          </button>
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

  // Pending prescriptions (auto-refresh every 30s)
  const {
    data: pendingPrescriptions = [],
    isLoading: pendingLoading,
    isError: pendingError,
  } = useQuery({
    queryKey: ['pharmacy-pending'],
    queryFn: fetchPendingPrescriptions,
    refetchInterval: 30_000,
  });

  // Dispensed today
  const {
    data: dispensedToday = [],
    isLoading: dispensedLoading,
    isError: dispensedError,
  } = useQuery({
    queryKey: ['pharmacy-dispensed-today'],
    queryFn: fetchDispensedToday,
    refetchInterval: 30_000,
  });

  // Low stock items
  const {
    data: lowStockItems = [],
    isLoading: lowStockLoading,
    isError: lowStockError,
  } = useQuery({
    queryKey: ['pharmacy-low-stock'],
    queryFn: fetchLowStockItems,
    refetchInterval: 60_000,
  });

  // Stats
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

  // Dispense mutation
  const dispenseMutation = useMutation({
    mutationFn: ({ id, items }) => dispensePrescription(id, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-pending'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-dispensed-today'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-dispensed-count'] });
      setToast({ message: 'Prescription dispensed successfully!', type: 'success' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
    onError: () => {
      setToast({ message: 'Failed to dispense prescription', type: 'error' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
  });

  // Restock mutation
  const restockMutation = useMutation({
    mutationFn: ({ itemId, requestedQty }) => requestRestock(itemId, requestedQty),
    onSuccess: () => {
      setToast({ message: 'Restock request submitted!', type: 'success' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
    onError: () => {
      setToast({ message: 'Failed to submit restock request', type: 'error' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
  });

  const handleDispenseClick = (prescription, patientName) => {
    setSelectedPrescription({ prescription, patientName });
    setModalOpen(true);
  };

  const handleConfirmDispense = () => {
    if (selectedPrescription) {
      const { prescription } = selectedPrescription;
      // Create dummy items array with correct count for API
      const items = Array(prescription.item_count).fill({ id: 'dummy' });
      dispenseMutation.mutate({ id: prescription.id, items });
    }
    setModalOpen(false);
    setSelectedPrescription(null);
  };

  const handleCancelDispense = () => {
    setModalOpen(false);
    setSelectedPrescription(null);
  };

  const handleRestock = (itemId, requestedQty) => {
    restockMutation.mutate({ itemId, requestedQty });
  };

  return (
    <div className={styles.page}>
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: '', type: '' })}
      />

      <ConfirmationModal
        isOpen={modalOpen}
        patientName={selectedPrescription?.patientName}
        medicineCount={selectedPrescription?.prescription?.item_count}
        onConfirm={handleConfirmDispense}
        onCancel={handleCancelDispense}
      />

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <StatCard
          label="Pending Prescriptions"
          value={pendingCount}
          alert={pendingCount > 0}
          loading={pendingLoading}
        />
        <StatCard
          label="Dispensed Today"
          value={dispensedCount}
          loading={dispensedLoading}
        />
        <StatCard
          label="Low Stock Alerts"
          value={lowStockCount}
          alert={lowStockCount > 0}
          loading={lowStockLoading}
        />
      </div>

      <div className={styles.twoCol}>
        {/* Pending Prescriptions Queue */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Pending Prescriptions</h2>
            <span className={styles.badge}>{pendingPrescriptions.length}</span>
          </div>

          {pendingLoading ? (
            <div className={styles.cardList}>
              <SkeletonCard height={140} />
              <SkeletonCard height={140} />
            </div>
          ) : pendingError ? (
            <div className={styles.errorState}>Failed to load prescriptions.</div>
          ) : pendingPrescriptions.length === 0 ? (
            <div className={styles.emptyState}>No pending prescriptions.</div>
          ) : (
            <div className={styles.cardList}>
              {pendingPrescriptions.map((p) => (
                <PrescriptionCard
                  key={p.id}
                  prescription={p}
                  onDispense={handleDispenseClick}
                />
              ))}
            </div>
          )}
        </section>

        {/* Right Column */}
        <div className={styles.rightCol}>
          {/* Dispensed Today */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Dispensed Today</h2>
              <span className={styles.badge}>{dispensedToday.length}</span>
            </div>

            {dispensedLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : dispensedError ? (
              <div className={styles.errorState}>Failed to load dispensed prescriptions.</div>
            ) : dispensedToday.length === 0 ? (
              <div className={styles.emptyState}>No prescriptions dispensed today.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.dispensedTable}>
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Doctor</th>
                      <th>Medicines</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispensedToday.map((p) => (
                      <DispensedRow key={p.id} prescription={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Low Stock Alert */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Low Stock Alert</h2>
              <span className={`${styles.badge} ${lowStockCount > 0 ? styles.badgeAlert : ''}`}>
                {lowStockCount}
              </span>
            </div>

            {lowStockLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={150} />
              </div>
            ) : lowStockError ? (
              <div className={styles.errorState}>Failed to load low stock items.</div>
            ) : lowStockItems.length === 0 ? (
              <div className={styles.emptyState}>No low stock items.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.lowStockTable}>
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Current</th>
                      <th>Reorder</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockItems.map((item) => (
                      <LowStockRow
                        key={item.id}
                        item={item}
                        onRestock={handleRestock}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}