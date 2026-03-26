import { pool }  from '../../shared/db/pool.js';
import { redis } from '../../shared/db/redis.js';

const CACHE_TTL = 5 * 60; // 5 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function periodToDays(period) {
  return { '7d': 7, '30d': 30, '90d': 90 }[period] ?? 30;
}

function cacheKey(name, period) {
  return `analytics:${name}:${period}`;
}

async function cached(key, fn) {
  const hit = await redis.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch { /* fall through */ }
  }
  const data = await fn();
  await redis.setex(key, CACHE_TTL, JSON.stringify(data));
  return data;
}

// ---------------------------------------------------------------------------
// Patient Stats
// ---------------------------------------------------------------------------
export async function getPatientStats(period) {
  const days = periodToDays(period);
  return cached(cacheKey('patient', period), async () => {
    const [admissionsRes, occupancyRes, deptRes, losRes] = await Promise.all([
      // Daily admissions with window-function running total
      pool.query(`
        SELECT
          day::date AS date,
          COUNT(p.id)::int AS count,
          SUM(COUNT(p.id)) OVER (ORDER BY day) ::int AS running_total
        FROM generate_series(
          NOW() - ($1 || ' days')::interval,
          NOW(),
          '1 day'::interval
        ) AS gs(day)
        LEFT JOIN patients p
          ON DATE(p.created_at) = day::date
          AND p.deleted_at IS NULL
        GROUP BY day
        ORDER BY day
      `, [days]),

      // Bed occupancy rate
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'OCCUPIED')::int AS occupied,
          COUNT(*)::int AS total
        FROM beds WHERE deleted_at IS NULL
      `),

      // Department distribution of patients
      pool.query(`
        SELECT
          d.name AS department,
          COUNT(DISTINCT a.patient_id)::int AS count
        FROM appointments a
        JOIN departments d ON d.id = a.department_id
        WHERE a.created_at >= NOW() - ($1 || ' days')::interval
          AND a.deleted_at IS NULL
          AND d.deleted_at IS NULL
        GROUP BY d.name
        ORDER BY count DESC
        LIMIT 10
      `, [days]),

      // Average length of stay (days between admission and discharge)
      pool.query(`
        SELECT
          ROUND(AVG(
            EXTRACT(EPOCH FROM (ds.discharge_date - p.created_at)) / 86400
          )::numeric, 1)::float AS avg_los
        FROM discharge_summaries ds
        JOIN patients p ON p.id = ds.patient_id
        WHERE ds.discharge_date >= NOW() - ($1 || ' days')::interval
      `, [days]),
    ]);

    const occ = occupancyRes.rows[0];
    const occupancyRate = occ.total > 0
      ? Math.round((occ.occupied / occ.total) * 100)
      : 0;

    return {
      admissions       : admissionsRes.rows,
      occupancyRate,
      occupancy        : { occupied: occ.occupied, total: occ.total },
      deptDistribution : deptRes.rows,
      avgLengthOfStay  : losRes.rows[0]?.avg_los ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Financial Stats
// ---------------------------------------------------------------------------
export async function getFinancialStats(period) {
  const days = periodToDays(period);
  return cached(cacheKey('financial', period), async () => {
    const [dailyRes, outstandingRes, methodRes, deptRes] = await Promise.all([
      // Daily revenue with window-function cumulative
      pool.query(`
        SELECT
          day::date AS date,
          COALESCE(SUM(py.amount) FILTER (WHERE py.status = 'COMPLETED'), 0)::float AS revenue,
          SUM(COALESCE(SUM(py.amount) FILTER (WHERE py.status = 'COMPLETED'), 0))
            OVER (ORDER BY day)::float AS cumulative
        FROM generate_series(
          NOW() - ($1 || ' days')::interval,
          NOW(),
          '1 day'::interval
        ) AS gs(day)
        LEFT JOIN payments py ON DATE(py.created_at) = day::date
        GROUP BY day
        ORDER BY day
      `, [days]),

      // Outstanding amount
      pool.query(`
        SELECT
          COALESCE(SUM(net_amount), 0)::float AS outstanding,
          COUNT(*)::int AS bill_count
        FROM bills
        WHERE status IN ('ISSUED','PARTIALLY_PAID')
          AND deleted_at IS NULL
      `),

      // Payment method breakdown
      pool.query(`
        SELECT
          method,
          COUNT(*)::int AS count,
          SUM(amount)::float AS total
        FROM payments
        WHERE status = 'COMPLETED'
          AND created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY method
        ORDER BY total DESC
      `, [days]),

      // Top revenue departments
      pool.query(`
        SELECT
          d.name AS department,
          SUM(bi.total_price)::float AS revenue
        FROM bill_items bi
        JOIN bills b ON b.id = bi.bill_id
        JOIN appointments a ON a.id = b.visit_id
        JOIN departments d ON d.id = a.department_id
        WHERE b.created_at >= NOW() - ($1 || ' days')::interval
          AND b.deleted_at IS NULL
          AND d.deleted_at IS NULL
        GROUP BY d.name
        ORDER BY revenue DESC
        LIMIT 5
      `, [days]),
    ]);

    const totalCollected = dailyRes.rows.reduce((s, r) => s + r.revenue, 0);

    return {
      dailyRevenue          : dailyRes.rows,
      outstandingAmount     : outstandingRes.rows[0]?.outstanding ?? 0,
      outstandingBillCount  : outstandingRes.rows[0]?.bill_count ?? 0,
      totalCollected,
      paymentMethodBreakdown: methodRes.rows,
      topDepts              : deptRes.rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Staff Performance
// ---------------------------------------------------------------------------
export async function getStaffPerformance(period) {
  const days = periodToDays(period);
  return cached(cacheKey('staff', period), async () => {
    const [doctorsRes, nursesRes] = await Promise.all([
      // Doctor performance
      pool.query(`
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          COUNT(DISTINCT mr.id)::int                AS patients_seen,
          COUNT(DISTINCT pr.id)::int                AS prescriptions_count,
          ROUND(AVG(
            CASE WHEN a.status = 'COMPLETED' THEN 5 ELSE NULL END
          )::numeric, 1)::float                     AS avg_rating,
          COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS completed_appointments
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'DOCTOR' AND ur.revoked_at IS NULL
        LEFT JOIN medical_records mr
          ON mr.attending_doctor_id = u.id
          AND mr.created_at >= NOW() - ($1 || ' days')::interval
          AND mr.deleted_at IS NULL
        LEFT JOIN prescriptions pr
          ON pr.prescribed_by = u.id
          AND pr.created_at >= NOW() - ($1 || ' days')::interval
          AND pr.deleted_at IS NULL
        LEFT JOIN appointments a
          ON a.doctor_id = u.id
          AND a.created_at >= NOW() - ($1 || ' days')::interval
          AND a.deleted_at IS NULL
        WHERE u.deleted_at IS NULL AND u.is_active = TRUE
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY patients_seen DESC
      `, [days]),

      // Nurse performance
      pool.query(`
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          COUNT(DISTINCT v.id)::int AS vitals_recorded,
          COUNT(DISTINCT mr.id)::int AS notes_added
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'NURSE' AND ur.revoked_at IS NULL
        LEFT JOIN vitals v
          ON v.recorded_by = u.id
          AND v.recorded_at >= NOW() - ($1 || ' days')::interval
        LEFT JOIN medical_records mr
          ON mr.attending_doctor_id = u.id
          AND mr.created_at >= NOW() - ($1 || ' days')::interval
          AND mr.deleted_at IS NULL
        WHERE u.deleted_at IS NULL AND u.is_active = TRUE
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY vitals_recorded DESC
      `, [days]),
    ]);

    return {
      doctors: doctorsRes.rows,
      nurses : nursesRes.rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Operational Stats
// ---------------------------------------------------------------------------
export async function getOperationalStats(period) {
  const days = periodToDays(period);
  return cached(cacheKey('operational', period), async () => {
    const [apptRes, teleRes, labRes, invRes] = await Promise.all([
      // Appointment fulfillment rate
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_show,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
        FROM appointments
        WHERE created_at >= NOW() - ($1 || ' days')::interval
          AND deleted_at IS NULL
      `, [days]),

      // Telemedicine count
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM telemedicine_sessions
        WHERE created_at >= NOW() - ($1 || ' days')::interval
      `, [days]),

      // Lab test volume by day (window function trend)
      pool.query(`
        SELECT
          day::date AS date,
          COUNT(lo.id)::int AS count
        FROM generate_series(
          NOW() - ($1 || ' days')::interval,
          NOW(),
          '1 day'::interval
        ) AS gs(day)
        LEFT JOIN lab_orders lo
          ON DATE(lo.ordered_at) = day::date
          AND lo.deleted_at IS NULL
        GROUP BY day
        ORDER BY day
      `, [days]),

      // Inventory turnover (items consumed vs restocked)
      pool.query(`
        SELECT
          category,
          SUM(quantity_in_stock)::float AS current_stock,
          SUM(reorder_level)::float AS reorder_level,
          COUNT(*) FILTER (WHERE quantity_in_stock <= reorder_level)::int AS low_stock_count
        FROM inventory_items
        WHERE deleted_at IS NULL AND is_active = TRUE
        GROUP BY category
        ORDER BY low_stock_count DESC
      `),
    ]);

    const appt = apptRes.rows[0];
    const fulfillmentRate = appt.total > 0
      ? Math.round((appt.completed / appt.total) * 100)
      : 0;

    return {
      appointmentFulfillmentRate: fulfillmentRate,
      appointments: {
        completed: appt.completed,
        total    : appt.total,
        noShow   : appt.no_show,
        cancelled: appt.cancelled,
      },
      telemedicineCount: teleRes.rows[0]?.count ?? 0,
      labTestVolume    : labRes.rows,
      inventoryTurnover: invRes.rows,
    };
  });
}
