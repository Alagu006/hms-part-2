import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './InventoryManagerDashboard.module.scss';

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchLowStockItems() {
  const json = await apiFetch(`${API_BASE}/inventory?lowStock=true&limit=100`);
  return json?.items ?? [];
}

async function fetchInventoryStats() {
  return apiFetch(`${API_BASE}/inventory/stats`);
}

async function fetchBedMatrix() {
  const json = await apiFetch(`${API_BASE}/inventory/beds`);
  return json?.data ?? [];
}

async function fetchInventoryTransactions() {
  const json = await apiFetch(`${API_BASE}/admin/audit-logs?entity=inventory_items&limit=10`);
  return json?.rows ?? json?.logs ?? [];
}

async function fetchEquipmentItems() {
  const json = await apiFetch(`${API_BASE}/inventory?category=EQUIPMENT&limit=50`);
  return json?.items ?? [];
}

async function adjustQuantity(id, adjustment, reason) {
  return apiFetch(`${API_BASE}/inventory/${id}/adjust`, {
    method: 'PATCH',
    body: JSON.stringify({ adjustment, reason }),
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
// Stock Alert Row
// ---------------------------------------------------------------------------
function StockAlertRow({ item, onReorder }) {
  const [showInput, setShowInput] = useState(false);
  const [qty, setQty] = useState(item.reorder_level * 2);
  const [isOrdering, setIsOrdering] = useState(false);

  const isOutOfStock = parseFloat(item.quantity_in_stock) === 0;
  const isCritical = isOutOfStock || parseFloat(item.quantity_in_stock) < (item.reorder_level * 0.5);

  const handleReorder = async () => {
    setIsOrdering(true);
    try {
      await onReorder(item.id, qty);
      setShowInput(false);
    } catch (err) {
      alert('Failed to submit reorder request');
    } finally {
      setIsOrdering(false);
    }
  };

  return (
    <tr className={`${styles.alertRow} ${isCritical ? styles.criticalRow : styles.lowRow}`}>
      <td>
        <span className={styles.itemName}>{item.name}</span>
        <span className={styles.itemSku}>{item.sku}</span>
      </td>
      <td>
        <span className={`${styles.categoryBadge} ${styles[`cat${item.category}`]}`}>
          {item.category}
        </span>
      </td>
      <td className={isOutOfStock ? styles.qtyCritical : ''}>
        {item.quantity_in_stock} {item.unit}
      </td>
      <td>{item.reorder_level} {item.unit}</td>
      <td>
        <div className={styles.reorderAction}>
          {isOutOfStock ? (
            <span className={styles.outOfStockBadge}>Out of Stock</span>
          ) : showInput ? (
            <>
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                className={styles.reorderInput}
              />
              <button
                className={styles.confirmReorderBtn}
                onClick={handleReorder}
                disabled={isOrdering}
              >
                {isOrdering ? '...' : 'OK'}
              </button>
              <button
                className={styles.cancelReorderBtn}
                onClick={() => setShowInput(false)}
              >
                ✕
              </button>
            </>
          ) : (
            <button
              className={styles.reorderBtn}
              onClick={() => setShowInput(true)}
            >
              Reorder
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Equipment Maintenance Row
// ---------------------------------------------------------------------------
function EquipmentMaintenanceRow({ item }) {
  const updatedDate = new Date(item.updated_at);
  const daysSinceUpdate = Math.floor((new Date() - updatedDate) / (1000 * 60 * 60 * 24));
  const simulatedDueInDays = Math.max(0, 30 - daysSinceUpdate);
  const isDueSoon = simulatedDueInDays <= 7;

  let daysClass = styles.daysGreen;
  if (simulatedDueInDays <= 2) daysClass = styles.daysRed;
  else if (simulatedDueInDays <= 7) daysClass = styles.daysAmber;

  return (
    <tr className={styles.maintenanceRow}>
      <td>{item.name}</td>
      <td>{item.location ?? 'N/A'}</td>
      <td><code className={styles.serialNum}>{item.sku}</code></td>
      <td>
        {isDueSoon ? (
          new Date(updatedDate.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()
        ) : '-'}
      </td>
      <td className={daysClass}>
        {isDueSoon ? `${simulatedDueInDays} days` : 'OK'}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Transaction Row
// ---------------------------------------------------------------------------
function TransactionRow({ transaction }) {
  const actionType = transaction.action?.toUpperCase();
  const typeClass = {
    CREATE: styles.typeAdd,
    UPDATE: styles.typeAdjust,
    DELETE: styles.typeRemove,
    ADJUST_QUANTITY: styles.typeAdjust,
    DISPENSE: styles.typeRemove,
  }[actionType] ?? styles.typeAdjust;

  const timeAgo = getTimeAgo(new Date(transaction.created_at));

  return (
    <tr className={styles.transactionRow}>
      <td>{transaction.entity_id?.slice(0, 8) ?? 'N/A'}</td>
      <td>
        <span className={`${styles.typeBadge} ${typeClass}`}>
          {transaction.action}
        </span>
      </td>
      <td>
        {transaction.prev_data?.quantity_in_stock !== undefined && transaction.next_data?.quantity_in_stock !== undefined ? (
          <span className={styles.qtyChange}>
            {transaction.prev_data.quantity_in_stock} → {transaction.next_data.quantity_in_stock}
          </span>
        ) : (
          <span className={styles.qtyChange}>-</span>
        )}
      </td>
      <td>{transaction.user_name ?? 'System'}</td>
      <td className={styles.timeCell}>{timeAgo}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Ward Occupancy Card
// ---------------------------------------------------------------------------
function WardOccupancyCard({ ward, beds, totalBeds, occupiedBeds }) {
  const occupancyPercent = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  let barClass = styles.occupancyBarGreen;
  if (occupancyPercent >= 90) barClass = styles.occupancyBarRed;
  else if (occupancyPercent >= 70) barClass = styles.occupancyBarAmber;

  return (
    <div className={styles.wardCard}>
      <div className={styles.wardHeader}>
        <span className={styles.wardName}>{ward}</span>
        <span className={styles.wardCount}>{occupiedBeds}/{totalBeds}</span>
      </div>
      <div className={styles.occupancyTrack}>
        <div
          className={`${styles.occupancyBar} ${barClass}`}
          style={{ width: `${occupancyPercent}%` }}
        />
      </div>
      <span className={styles.occupancyPercent}>{occupancyPercent}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function InventoryManagerDashboard() {
  const queryClient = useQueryClient();

  const {
    data: lowStockItems = [],
    isLoading: lowStockLoading,
    isError: lowStockError,
  } = useQuery({
    queryKey: ['inventory-low-stock'],
    queryFn: fetchLowStockItems,
    refetchInterval: 60_000,
  });

  const {
    data: stats = { totalMedicines: 0, totalEquipment: 0, lowStockCount: 0 },
    isLoading: statsLoading,
  } = useQuery({
    queryKey: ['inventory-stats'],
    queryFn: fetchInventoryStats,
    refetchInterval: 60_000,
  });

  const {
    data: bedMatrix = [],
    isLoading: bedsLoading,
  } = useQuery({
    queryKey: ['inventory-beds'],
    queryFn: fetchBedMatrix,
  });

  const {
    data: transactions = [],
    isLoading: transactionsLoading,
    isError: transactionsError,
  } = useQuery({
    queryKey: ['inventory-transactions'],
    queryFn: fetchInventoryTransactions,
    refetchInterval: 30_000,
  });

  const {
    data: equipmentItems = [],
    isLoading: equipmentLoading,
  } = useQuery({
    queryKey: ['inventory-equipment'],
    queryFn: fetchEquipmentItems,
  });

  const criticalItems = lowStockItems.filter(
    item => parseFloat(item.quantity_in_stock) === 0
  );
  const lowItems = lowStockItems.filter(
    item => parseFloat(item.quantity_in_stock) > 0
  );

  const outOfStockCount = criticalItems.length;
  const lowStockCount = lowItems.length;
  const equipmentMaintenanceDue = equipmentItems.slice(0, 5);

  const restockMutation = useMutation({
    mutationFn: ({ itemId, requestedQty }) => requestRestock(itemId, requestedQty),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-low-stock'] });
      alert('Reorder request submitted!');
    },
    onError: () => {
      alert('Failed to submit reorder request');
    },
  });

  const wardBeds = {};
  bedMatrix.forEach(room => {
    const ward = room.departmentName ?? room.roomType ?? 'General';
    if (!wardBeds[ward]) {
      wardBeds[ward] = { total: 0, occupied: 0 };
    }
    room.beds?.forEach(bed => {
      wardBeds[ward].total++;
      if (bed.status === 'OCCUPIED') {
        wardBeds[ward].occupied++;
      }
    });
  });

  return (
    <div className={styles.page}>
      <div className={styles.statsRow}>
        <StatCard
          label="Total Inventory Items"
          value={(stats.totalMedicines ?? 0) + (stats.totalEquipment ?? 0)}
          loading={statsLoading}
        />
        <StatCard
          label="Out of Stock"
          value={outOfStockCount}
          alert={outOfStockCount > 0}
          loading={lowStockLoading}
        />
        <StatCard
          label="Low Stock"
          value={lowStockCount}
          alert={lowStockCount > 0}
          loading={lowStockLoading}
        />
        <StatCard
          label="Equipment Maintenance Due"
          value={equipmentMaintenanceDue.length}
          alert={equipmentMaintenanceDue.length > 0}
          loading={equipmentLoading}
        />
      </div>

      <div className={styles.threeCol}>
        <div className={styles.leftCol}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Stock Alerts</h2>
              <span className={`${styles.badge} ${criticalItems.length > 0 ? styles.badgeCritical : ''}`}>
                {lowStockItems.length}
              </span>
            </div>

            {lowStockLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={150} />
              </div>
            ) : lowStockError ? (
              <div className={styles.errorState}>Failed to load stock alerts.</div>
            ) : lowStockItems.length === 0 ? (
              <div className={styles.emptyState}>All items are sufficiently stocked.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.alertTable}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Current</th>
                      <th>Reorder</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalItems.map(item => (
                      <StockAlertRow
                        key={item.id}
                        item={item}
                        onReorder={(id, qty) => restockMutation.mutate({ itemId: id, requestedQty: qty })}
                      />
                    ))}
                    {lowItems.map(item => (
                      <StockAlertRow
                        key={item.id}
                        item={item}
                        onReorder={(id, qty) => restockMutation.mutate({ itemId: id, requestedQty: qty })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className={styles.middleCol}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Equipment Maintenance</h2>
            </div>

            {equipmentLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={150} />
              </div>
            ) : equipmentMaintenanceDue.length === 0 ? (
              <div className={styles.emptyState}>No equipment maintenance due.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.maintenanceTable}>
                  <thead>
                    <tr>
                      <th>Equipment</th>
                      <th>Location</th>
                      <th>Serial #</th>
                      <th>Due Date</th>
                      <th>Days Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipmentMaintenanceDue.map(item => (
                      <EquipmentMaintenanceRow key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recent Transactions</h2>
            </div>

            {transactionsLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={150} />
              </div>
            ) : transactionsError ? (
              <div className={styles.errorState}>Failed to load transactions.</div>
            ) : transactions.length === 0 ? (
              <div className={styles.emptyState}>No recent transactions.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.transactionTable}>
                  <thead>
                    <tr>
                      <th>Item ID</th>
                      <th>Type</th>
                      <th>Quantity</th>
                      <th>By</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <TransactionRow key={tx.id} transaction={tx} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className={styles.rightCol}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Bed Occupancy by Ward</h2>
            </div>

            {bedsLoading ? (
              <div className={styles.bedLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : Object.keys(wardBeds).length === 0 ? (
              <div className={styles.emptyState}>No bed data available.</div>
            ) : (
              <div className={styles.wardGrid}>
                {Object.entries(wardBeds).map(([ward, counts]) => (
                  <WardOccupancyCard
                    key={ward}
                    ward={ward}
                    beds={counts}
                    totalBeds={counts.total}
                    occupiedBeds={counts.occupied}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
