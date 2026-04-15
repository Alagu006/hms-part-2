import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import SkeletonLoader from '../../shared/components/SkeletonLoader.jsx';
import styles from './Analytics.module.scss';

const API  = import.meta.env.VITE_API_URL ?? '/api';

const PERIODS = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const TABS = ['Patient', 'Financial', 'Staff', 'Operational'];

const PIE_COLORS = ['#1a56db','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtCurrency(n) {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`${styles.statCard} ${accent ? styles[`accent_${accent}`] : ''}`}>
      <span className={styles.statValue}>{value ?? '—'}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable table hook
// ---------------------------------------------------------------------------
function useSorted(rows, defaultKey) {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState('desc');

  const toggle = (key) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...(rows ?? [])].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  return { sorted, sortKey, sortDir, toggle };
}

// ---------------------------------------------------------------------------
// Patient Tab
// ---------------------------------------------------------------------------
function PatientTab({ data }) {
  if (!data) return null;
  const admissions = (data.admissions ?? []).map(r => ({ ...r, date: fmtDate(r.date) }));

  return (
    <>
      <div className={styles.statsRow}>
        <StatCard label="Occupancy Rate"    value={`${data.occupancyRate}%`}
          sub={`${data.occupancy?.occupied ?? 0} / ${data.occupancy?.total ?? 0} beds`}
          accent={data.occupancyRate > 85 ? 'red' : 'blue'} />
        <StatCard label="Avg Length of Stay" value={`${data.avgLengthOfStay ?? 0}d`} accent="green" />
        <StatCard label="Departments"        value={data.deptDistribution?.length ?? 0} accent="yellow" />
      </div>

      <div className={styles.chartsGrid}>
        <div className={`${styles.chartCard} ${styles.full}`}>
          <p className={styles.chartTitle}>Daily Admissions Trend</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={admissions}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count"         name="Admissions"    stroke="#1a56db" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="running_total" name="Running Total"  stroke="#10b981" strokeWidth={1} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Department Distribution</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data.deptDistribution ?? []}
                dataKey="count"
                nameKey="department"
                cx="50%" cy="50%"
                outerRadius={90}
                label={({ department, percent }) => `${department} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {(data.deptDistribution ?? []).map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v, n) => [v, n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Admissions by Department</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.deptDistribution ?? []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 11 }} width={100} />
              <Tooltip />
              <Bar dataKey="count" name="Patients" fill="#1a56db" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Financial Tab
// ---------------------------------------------------------------------------
function FinancialTab({ data }) {
  if (!data) return null;
  const daily = (data.dailyRevenue ?? []).map(r => ({ ...r, date: fmtDate(r.date) }));

  return (
    <>
      <div className={styles.statsRow}>
        <StatCard label="Total Collected"   value={fmtCurrency(data.totalCollected)}   accent="green" />
        <StatCard label="Outstanding"       value={fmtCurrency(data.outstandingAmount)}
          sub={`${data.outstandingBillCount ?? 0} unpaid bills`} accent="red" />
      </div>

      <div className={styles.chartsGrid}>
        <div className={`${styles.chartCard} ${styles.full}`}>
          <p className={styles.chartTitle}>Daily Revenue</p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => [fmtCurrency(v)]} />
              <Legend />
              <Bar  dataKey="revenue"    name="Revenue"    fill="#1a56db" radius={[4,4,0,0]} />
              <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Payment Methods</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data.paymentMethodBreakdown ?? []}
                dataKey="total"
                nameKey="method"
                cx="50%" cy="50%"
                outerRadius={90}
                label={({ method, percent }) => `${method} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {(data.paymentMethodBreakdown ?? []).map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={v => [fmtCurrency(v)]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Top Revenue Departments</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.topDepts ?? []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 11 }} width={110} />
              <Tooltip formatter={v => [fmtCurrency(v)]} />
              <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff Tab
// ---------------------------------------------------------------------------
function StaffTab({ data }) {
  const { sorted, sortKey, sortDir, toggle } = useSorted(data?.doctors, 'patients_seen');

  if (!data) return null;

  const SortTh = ({ k, children }) => (
    <th onClick={() => toggle(k)}>
      {children}
      <span className={styles.sortIcon}>
        {sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
      </span>
    </th>
  );

  const barData = sorted.slice(0, 10).map(d => ({
    name            : `Dr. ${d.last_name}`,
    patients_seen   : d.patients_seen,
    prescriptions   : d.prescriptions_count,
  }));

  return (
    <>
      <div className={styles.chartsGrid}>
        <div className={`${styles.chartCard} ${styles.full}`}>
          <p className={styles.chartTitle}>Doctor Activity (Top 10)</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="patients_seen" name="Patients Seen"    fill="#1a56db" radius={[4,4,0,0]} />
              <Bar dataKey="prescriptions" name="Prescriptions"    fill="#10b981" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={styles.chartCard}>
        <p className={styles.chartTitle}>Doctor Performance</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Doctor</th>
                <SortTh k="patients_seen">Patients Seen</SortTh>
                <SortTh k="prescriptions_count">Prescriptions</SortTh>
                <SortTh k="completed_appointments">Completed Appts</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map(d => (
                <tr key={d.id}>
                  <td>Dr. {d.first_name} {d.last_name}</td>
                  <td>{d.patients_seen}</td>
                  <td>{d.prescriptions_count}</td>
                  <td>{d.completed_appointments}</td>
                </tr>
              ))}
              {!sorted.length && (
                <tr><td colSpan={4} className={styles.empty}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Operational Tab
// ---------------------------------------------------------------------------
function OperationalTab({ data }) {
  if (!data) return null;
  const labData = (data.labTestVolume ?? []).map(r => ({ ...r, date: fmtDate(r.date) }));

  return (
    <>
      <div className={styles.statsRow}>
        <StatCard label="Fulfillment Rate"  value={`${data.appointmentFulfillmentRate}%`}
          sub={`${data.appointments?.completed ?? 0} / ${data.appointments?.total ?? 0} completed`}
          accent={data.appointmentFulfillmentRate < 70 ? 'red' : 'green'} />
        <StatCard label="Telemedicine"      value={data.telemedicineCount ?? 0}  accent="blue" />
        <StatCard label="No-shows"          value={data.appointments?.noShow ?? 0} accent="yellow" />
        <StatCard label="Cancelled"         value={data.appointments?.cancelled ?? 0} accent="red" />
      </div>

      <div className={styles.chartsGrid}>
        <div className={`${styles.chartCard} ${styles.full}`}>
          <p className={styles.chartTitle}>Lab Test Volume</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={labData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Tests" fill="#8b5cf6" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={`${styles.chartCard} ${styles.full}`}>
          <p className={styles.chartTitle}>Inventory by Category</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Category</th><th>Current Stock</th><th>Reorder Level</th><th>Low Stock Items</th></tr>
              </thead>
              <tbody>
                {(data.inventoryTurnover ?? []).map((r, i) => (
                  <tr key={i}>
                    <td>{r.category}</td>
                    <td>{Number(r.current_stock).toFixed(0)}</td>
                    <td>{Number(r.reorder_level).toFixed(0)}</td>
                    <td style={{ color: r.low_stock_count > 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                      {r.low_stock_count}
                    </td>
                  </tr>
                ))}
                {!data.inventoryTurnover?.length && (
                  <tr><td colSpan={4} className={styles.empty}>No data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Analytics component
// ---------------------------------------------------------------------------
export default function Analytics() {
  const [activeTab, setActiveTab] = useState('Patient');
  const [period, setPeriod]       = useState('30d');
  const [data, setData]           = useState({});
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const endpointMap = {
    Patient    : 'patient-stats',
    Financial  : 'financial',
    Staff      : 'staff-performance',
    Operational: 'operational',
  };

  const fetchTab = useCallback(async (tab, p) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = endpointMap[tab];
      const json = await apiFetch(`${API}/analytics/${endpoint}?period=${p}`);
      setData(prev => ({ ...prev, [`${tab}_${p}`]: json }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = `${activeTab}_${period}`;
    if (!data[key]) fetchTab(activeTab, period);
  }, [activeTab, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentData = data[`${activeTab}_${period}`];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Analytics</h1>
        <div className={styles.periodSelector}>
          {PERIODS.map(p => (
            <button
              key={p.value}
              className={`${styles.periodBtn} ${period === p.value ? styles.active : ''}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t}
            className={`${styles.tab} ${activeTab === t ? styles.active : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <SkeletonLoader variant="page" />
      ) : (
        <>
          {activeTab === 'Patient'     && <PatientTab     data={currentData} />}
          {activeTab === 'Financial'   && <FinancialTab   data={currentData} />}
          {activeTab === 'Staff'       && <StaffTab       data={currentData} />}
          {activeTab === 'Operational' && <OperationalTab data={currentData} />}
        </>
      )}
    </div>
  );
}
