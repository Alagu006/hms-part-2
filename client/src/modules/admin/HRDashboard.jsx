import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './HRDashboard.module.scss';

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchPendingLeaves() {
  const json = await apiFetch(`${API_BASE}/leaves?status=PENDING&limit=50`);
  return json?.leaves ?? (Array.isArray(json) ? json : []);
}

async function fetchApprovedLeavesToday() {
  const today = new Date().toISOString().split('T')[0];
  const json = await apiFetch(`${API_BASE}/leaves?status=APPROVED&dateFrom=${today}&dateTo=${today}`);
  return json?.leaves ?? (Array.isArray(json) ? json : []);
}

async function fetchShiftsThisWeek() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const startStr = startOfWeek.toISOString().split('T')[0];
  const endStr = endOfWeek.toISOString().split('T')[0];

  const json = await apiFetch(`${API_BASE}/shifts?limit=100`);
  const shifts = json?.shifts ?? [];
  return shifts.filter(s => {
    const shiftDate = s.shift_date?.split('T')[0];
    return shiftDate >= startStr && shiftDate <= endStr;
  });
}

async function fetchLeaveBalances() {
  const json = await apiFetch(`${API_BASE}/leaves?status=APPROVED&limit=100`);
  const leaves = json?.leaves ?? (Array.isArray(json) ? json : []);

  const currentYear = new Date().getFullYear();
  const leaveTypes = ['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'EMERGENCY', 'COMPENSATORY'];
  const defaultAllocations = { ANNUAL: 15, SICK: 12, MATERNITY: 90, PATERNITY: 7, EMERGENCY: 5, COMPENSATORY: 0, UNPAID: 999 };

  const balanceSummary = {};
  leaveTypes.forEach(type => { balanceSummary[type] = { type, allocated: defaultAllocations[type], used: 0 }; });
  leaves.forEach(leave => {
    if (new Date(leave.start_date).getFullYear() === currentYear && balanceSummary[leave.leave_type]) {
      balanceSummary[leave.leave_type].used += parseFloat(leave.days_count) || 0;
    }
  });
  return Object.values(balanceSummary);
}

async function fetchMonthlyApprovedCount() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];
  const json = await apiFetch(`${API_BASE}/leaves?status=APPROVED&dateFrom=${firstOfMonth}&dateTo=${today}&limit=1`);
  const leaves = json?.leaves ?? (Array.isArray(json) ? json : []);
  return json?.total ?? leaves.length;
}

async function approveLeave(id) {
  return apiFetch(`${API_BASE}/leaves/${id}/approve`, { method: 'PATCH', body: JSON.stringify({}) });
}

async function rejectLeave(id, reviewNote) {
  return apiFetch(`${API_BASE}/leaves/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reviewNote }) });
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
// Pending Leave Row
// ---------------------------------------------------------------------------
function PendingLeaveRow({ leave, onApprove, onReject }) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const employeeName = `${leave.first_name} ${leave.last_name}`;
  const roleBadgeClass = styles[`role${(leave.role ?? 'STAFF').toUpperCase().replace('_', '')}`] ?? '';
  
  const formattedStart = new Date(leave.start_date).toLocaleDateString();
  const formattedEnd = new Date(leave.end_date).toLocaleDateString();
  
  const reason = leave.reason ?? '';
  const truncatedReason = reason.length > 60 ? reason.slice(0, 60) + '...' : reason;
  
  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      await onApprove(leave.id);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setIsProcessing(true);
    try {
      await onReject(leave.id, rejectReason);
      setShowRejectInput(false);
      setRejectReason('');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <tr className={styles.leaveRow}>
        <td className={styles.nameCell}>
          <span className={styles.employeeName}>{employeeName}</span>
          <span className={styles.employeeId}>{leave.employee_id ?? ''}</span>
        </td>
        <td>
          <span className={`${styles.roleBadge} ${roleBadgeClass}`}>
            {leave.department_name ?? 'General'}
          </span>
        </td>
        <td>
          <span className={`${styles.typeBadge} ${styles[`type${leave.leave_type}`] ?? ''}`}>
            {leave.leave_type?.replace('_', ' ')}
          </span>
        </td>
        <td className={styles.dateCell}>
          <span>{formattedStart}</span>
          <span className={styles.dateSeparator}>→</span>
          <span>{formattedEnd}</span>
        </td>
        <td className={styles.daysCell}>{leave.days_count}</td>
        <td className={styles.reasonCell}>
          {reason ? (
            <span 
              className={styles.reasonText}
              onClick={() => setIsExpanded(!isExpanded)}
              title="Click to expand"
            >
              {isExpanded ? reason : truncatedReason}
              {reason.length > 60 && (
                <span className={styles.expandToggle}>
                  {isExpanded ? ' ▲' : ' ▼'}
                </span>
              )}
            </span>
          ) : (
            <span className={styles.noReason}>—</span>
          )}
        </td>
        <td className={styles.actionCell}>
          <div className={styles.actionBtns}>
            <button
              className={styles.approveBtn}
              onClick={handleApprove}
              disabled={isProcessing}
            >
              Approve
            </button>
            <button
              className={styles.rejectBtn}
              onClick={() => setShowRejectInput(!showRejectInput)}
              disabled={isProcessing}
            >
              Reject
            </button>
          </div>
        </td>
      </tr>
      {showRejectInput && (
        <tr className={styles.rejectRow}>
          <td colSpan={7}>
            <div className={styles.rejectForm}>
              <input
                type="text"
                className={styles.rejectInput}
                placeholder="Enter rejection reason..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReject()}
              />
              <button
                className={styles.confirmRejectBtn}
                onClick={handleReject}
                disabled={!rejectReason.trim() || isProcessing}
              >
                Confirm Reject
              </button>
              <button
                className={styles.cancelRejectBtn}
                onClick={() => {
                  setShowRejectInput(false);
                  setRejectReason('');
                }}
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Absent Staff Row
// ---------------------------------------------------------------------------
function AbsentStaffRow({ leave }) {
  const employeeName = `${leave.first_name} ${leave.last_name}`;
  const returnDate = leave.end_date 
    ? new Date(leave.end_date).toLocaleDateString()
    : 'N/A';

  return (
    <tr className={styles.absentRow}>
      <td className={styles.nameCell}>
        <span className={styles.employeeName}>{employeeName}</span>
      </td>
      <td>{leave.department_name ?? 'General'}</td>
      <td>
        <span className={`${styles.typeBadge} ${styles[`type${leave.leave_type}`] ?? ''}`}>
          {leave.leave_type?.replace('_', ' ')}
        </span>
      </td>
      <td className={styles.returnCell}>Returns: {returnDate}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Shift Group
// ---------------------------------------------------------------------------
function ShiftGroup({ department, shifts }) {
  const morning = shifts.filter(s => s.shift_type === 'MORNING');
  const afternoon = shifts.filter(s => s.shift_type === 'AFTERNOON');
  const night = shifts.filter(s => s.shift_type === 'NIGHT');

  return (
    <div className={styles.shiftGroup}>
      <div className={styles.shiftGroupHeader}>
        <span className={styles.departmentName}>{department}</span>
        <button className={styles.editShiftBtn} disabled title="Coming soon">
          Edit
        </button>
      </div>
      <div className={styles.shiftRows}>
        <div className={styles.shiftRow}>
          <span className={styles.shiftLabel}>Morning</span>
          <div className={styles.staffPills}>
            {morning.length > 0 ? morning.map(s => (
              <span key={s.id} className={styles.staffPill}>
                {s.first_name} {s.last_name?.charAt(0)}.
              </span>
            )) : <span className={styles.noStaff}>Unassigned</span>}
          </div>
        </div>
        <div className={styles.shiftRow}>
          <span className={styles.shiftLabel}>Afternoon</span>
          <div className={styles.staffPills}>
            {afternoon.length > 0 ? afternoon.map(s => (
              <span key={s.id} className={styles.staffPill}>
                {s.first_name} {s.last_name?.charAt(0)}.
              </span>
            )) : <span className={styles.noStaff}>Unassigned</span>}
          </div>
        </div>
        <div className={styles.shiftRow}>
          <span className={styles.shiftLabel}>Night</span>
          <div className={styles.staffPills}>
            {night.length > 0 ? night.map(s => (
              <span key={s.id} className={styles.staffPill}>
                {s.first_name} {s.last_name?.charAt(0)}.
              </span>
            )) : <span className={styles.noStaff}>Unassigned</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave Balance Row
// ---------------------------------------------------------------------------
function LeaveBalanceRow({ balance }) {
  const remaining = Math.max(0, balance.allocated - balance.used);
  const usagePercent = balance.allocated > 0 
    ? Math.min(100, Math.round((balance.used / balance.allocated) * 100))
    : 0;
  
  return (
    <tr className={styles.balanceRow}>
      <td>
        <span className={`${styles.typeBadge} ${styles[`type${balance.type}`] ?? ''}`}>
          {balance.type?.replace('_', ' ')}
        </span>
      </td>
      <td className={styles.daysCell}>{balance.allocated}</td>
      <td className={styles.daysCell}>{balance.used}</td>
      <td className={styles.daysCell}>
        <span className={remaining === 0 ? styles.noBalance : styles.hasBalance}>
          {remaining}
        </span>
      </td>
      <td>
        <div className={styles.usageBar}>
          <div 
            className={styles.usageFill}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </td>
    </tr>
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
export default function HRDashboard() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState({ message: '', type: '' });

  // Pending leaves
  const {
    data: pendingLeaves = [],
    isLoading: pendingLoading,
    isError: pendingError,
  } = useQuery({
    queryKey: ['hr-pending-leaves'],
    queryFn: fetchPendingLeaves,
    refetchInterval: 30_000,
  });

  // Today's absent staff
  const {
    data: absentStaff = [],
    isLoading: absentLoading,
    isError: absentError,
  } = useQuery({
    queryKey: ['hr-absent-today'],
    queryFn: fetchApprovedLeavesToday,
    refetchInterval: 60_000,
  });

  // Shifts this week
  const {
    data: shiftsThisWeek = [],
    isLoading: shiftsLoading,
    isError: shiftsError,
  } = useQuery({
    queryKey: ['hr-shifts-week'],
    queryFn: fetchShiftsThisWeek,
    refetchInterval: 120_000,
  });

  // Leave balances
  const {
    data: leaveBalances = [],
    isLoading: balancesLoading,
  } = useQuery({
    queryKey: ['hr-leave-balances'],
    queryFn: fetchLeaveBalances,
  });

  // Monthly approved count
  const {
    data: monthlyApprovedCount = 0,
    isLoading: monthlyLoading,
  } = useQuery({
    queryKey: ['hr-monthly-approved'],
    queryFn: fetchMonthlyApprovedCount,
    refetchInterval: 60_000,
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: approveLeave,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-pending-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['hr-absent-today'] });
      setToast({ message: 'Leave approved successfully!', type: 'success' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
    onError: () => {
      setToast({ message: 'Failed to approve leave', type: 'error' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ id, reviewNote }) => rejectLeave(id, reviewNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-pending-leaves'] });
      setToast({ message: 'Leave rejected', type: 'success' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
    onError: () => {
      setToast({ message: 'Failed to reject leave', type: 'error' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
  });

  // Group shifts by department
  const shiftsByDepartment = {};
  shiftsThisWeek.forEach(shift => {
    const dept = shift.department_name ?? 'General';
    if (!shiftsByDepartment[dept]) {
      shiftsByDepartment[dept] = [];
    }
    shiftsByDepartment[dept].push(shift);
  });

  const handleApprove = (id) => approveMutation.mutate(id);
  const handleReject = (id, reviewNote) => rejectMutation.mutate({ id, reviewNote });

  return (
    <div className={styles.page}>
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: '', type: '' })}
      />

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <StatCard
          label="Pending Requests"
          value={pendingLeaves.length}
          alert={pendingLeaves.length > 0}
          loading={pendingLoading}
        />
        <StatCard
          label="Staff on Leave Today"
          value={absentStaff.length}
          loading={absentLoading}
        />
        <StatCard
          label="Shifts This Week"
          value={shiftsThisWeek.length}
          loading={shiftsLoading}
        />
        <StatCard
          label="Approved This Month"
          value={monthlyApprovedCount}
          loading={monthlyLoading}
        />
      </div>

      <div className={styles.twoCol}>
        <div className={styles.leftCol}>
          {/* Pending Leave Requests */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Pending Leave Requests</h2>
              <span className={`${styles.badge} ${pendingLeaves.length > 0 ? styles.badgeAlert : ''}`}>
                {pendingLeaves.length}
              </span>
            </div>

            {pendingLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : pendingError ? (
              <div className={styles.errorState}>Failed to load pending requests.</div>
            ) : pendingLeaves.length === 0 ? (
              <div className={styles.emptyState}>No pending leave requests.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.leaveTable}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Type</th>
                      <th>Duration</th>
                      <th>Days</th>
                      <th>Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingLeaves.map(leave => (
                      <PendingLeaveRow
                        key={leave.id}
                        leave={leave}
                        onApprove={handleApprove}
                        onReject={handleReject}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Leave Balance Overview */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Leave Balance Overview</h2>
            </div>

            {balancesLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={150} />
              </div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.balanceTable}>
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>Allocated</th>
                      <th>Used</th>
                      <th>Remaining</th>
                      <th>Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveBalances.map(balance => (
                      <LeaveBalanceRow key={balance.type} balance={balance} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className={styles.rightCol}>
          {/* Today's Absent Staff */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Staff on Leave Today</h2>
              <span className={styles.badge}>{absentStaff.length}</span>
            </div>

            {absentLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={150} />
              </div>
            ) : absentError ? (
              <div className={styles.errorState}>Failed to load absent staff.</div>
            ) : absentStaff.length === 0 ? (
              <div className={styles.emptyState}>No staff on leave today.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.absentTable}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Type</th>
                      <th>Returns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {absentStaff.map(leave => (
                      <AbsentStaffRow key={leave.id} leave={leave} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Shift Assignments */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Shifts This Week</h2>
              <span className={styles.badge}>{shiftsThisWeek.length}</span>
            </div>

            {shiftsLoading ? (
              <div className={styles.shiftLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : shiftsError ? (
              <div className={styles.errorState}>Failed to load shifts.</div>
            ) : Object.keys(shiftsByDepartment).length === 0 ? (
              <div className={styles.emptyState}>No shifts assigned this week.</div>
            ) : (
              <div className={styles.shiftGroups}>
                {Object.entries(shiftsByDepartment).map(([dept, shifts]) => (
                  <ShiftGroup
                    key={dept}
                    department={dept}
                    shifts={shifts}
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