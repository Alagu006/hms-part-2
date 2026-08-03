import crypto, { createHmac } from 'crypto';
import { pool } from '../../shared/db/pool.js';
import { auditLog } from '../../shared/middleware/audit.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';
import { logger } from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function generateBillNumber() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `BILL-${ts}-${rnd}`;
}

function calcItemTotal(unitPrice, quantity, discountPct) {
  const gross    = unitPrice * quantity;
  const discount = gross * (discountPct / 100);
  return +(gross - discount).toFixed(2);
}

// ---------------------------------------------------------------------------
// Auto-populate pending services for a patient
// ---------------------------------------------------------------------------
export async function getPendingServices(patientId) {
  const [consultations, labOrders, prescriptions, bedInfo] = await Promise.all([
    // Completed appointments not yet billed
    pool.query(
      `SELECT a.id, a.scheduled_at, u.first_name || ' ' || u.last_name AS doctor_name,
              d.name AS department
       FROM appointments a
       JOIN users u ON u.id = a.doctor_id
       LEFT JOIN departments d ON d.id = a.department_id
       WHERE a.patient_id = $1 AND a.status = 'COMPLETED'
         AND a.id NOT IN (
           SELECT DISTINCT bi.reference_id FROM bill_items bi
           WHERE bi.reference_type = 'APPOINTMENT'
         )`,
      [patientId]
    ),
    // Completed lab orders not yet billed
    pool.query(
      `SELECT lo.id, lo.test_name, lo.test_code, lo.ordered_at
       FROM lab_orders lo
       WHERE lo.patient_id = $1 AND lo.status = 'COMPLETED'
         AND lo.id NOT IN (
           SELECT DISTINCT bi.reference_id FROM bill_items bi
           WHERE bi.reference_type = 'LAB_ORDER'
         )`,
      [patientId]
    ),
    // Dispensed prescriptions not yet billed
    pool.query(
      `SELECT pi.id, m.name AS medicine_name, pi.quantity, pi.dosage
       FROM prescription_items pi
       JOIN prescriptions p ON p.id = pi.prescription_id
       JOIN medicines m ON m.id = pi.medicine_id
       WHERE p.patient_id = $1 AND p.status IN ('DISPENSED','PARTIALLY_DISPENSED')
         AND pi.id NOT IN (
           SELECT DISTINCT bi.reference_id FROM bill_items bi
           WHERE bi.reference_type = 'PRESCRIPTION_ITEM'
         )`,
      [patientId]
    ),
    // Current bed/room charges
    pool.query(
      `SELECT b.id AS bed_id, b.bed_number, r.room_number, r.room_type,
              p.created_at AS admitted_at
       FROM patients p
       JOIN beds b ON b.id = p.current_bed_id
       JOIN rooms r ON r.id = b.room_id
       WHERE p.id = $1 AND p.current_bed_id IS NOT NULL`,
      [patientId]
    ),
  ]);

  return {
    consultations : consultations.rows,
    labOrders     : labOrders.rows,
    prescriptions : prescriptions.rows,
    bedCharges    : bedInfo.rows,
  };
}

// ---------------------------------------------------------------------------
// Create bill
// ---------------------------------------------------------------------------
export async function createBill({ patientId, items, taxPercent, notes, dueDate, issuedBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const billNumber = generateBillNumber();

    // Calculate totals
    let subtotal = 0;
    const processedItems = items.map((item) => {
      const lineTotal = calcItemTotal(item.unitPrice, item.quantity, item.discount ?? 0);
      subtotal += lineTotal;
      return { ...item, lineTotal };
    });

    const taxAmount  = +(subtotal * (taxPercent / 100)).toFixed(2);
    const netAmount  = +(subtotal + taxAmount).toFixed(2);

    const { rows: [bill] } = await client.query(
      `INSERT INTO bills
         (patient_id, bill_number, status, total_amount, tax_amount, net_amount,
          notes, issued_by, issued_at, due_date)
       VALUES ($1,$2,'ISSUED',$3,$4,$5,$6,$7,NOW(),$8)
       RETURNING *`,
      [patientId, billNumber, subtotal, taxAmount, netAmount, notes ?? null, issuedBy, dueDate ?? null]
    );

    // Insert line items
    for (const item of processedItems) {
      await client.query(
        `INSERT INTO bill_items
           (bill_id, description, item_type, quantity, unit_price, discount_pct, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [bill.id, item.description, item.category, item.quantity,
         item.unitPrice, item.discount ?? 0, item.lineTotal]
      );
    }

    await client.query('COMMIT');
    await auditLog(issuedBy, 'CREATE', 'bills', bill.id, null, bill);

    // Notify patient
    setImmediate(async () => {
      try {
        const { rows: patRows } = await pool.query(
          'SELECT user_id FROM patients WHERE id = $1', [patientId]
        );
        if (patRows[0]) {
          await createNotification(
            patRows[0].user_id,
            NotificationType.BILL_GENERATED,
            'New bill generated',
            `Bill ${billNumber} for ₹${netAmount} has been issued. View and pay from My Bills.`,
            { entityType: 'BILL', entityId: bill.id, priority: 'MEDIUM' }
          );
        }
      } catch (err) {
        logger.error('[billing] Notification failed', { message: err.message });
      }
    });

    return bill;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Get bill history for patient
// ---------------------------------------------------------------------------
export async function getBillsByPatient(patientId) {
  const { rows: bills } = await pool.query(
    `SELECT b.*,
            u.first_name || ' ' || u.last_name AS issued_by_name,
            COALESCE(
              json_agg(bi ORDER BY bi.created_at) FILTER (WHERE bi.id IS NOT NULL),
              '[]'
            ) AS items,
            COALESCE(
              (SELECT json_agg(py ORDER BY py.created_at)
               FROM payments py WHERE py.bill_id = b.id),
              '[]'
            ) AS payments
     FROM bills b
     LEFT JOIN users u ON u.id = b.issued_by
     LEFT JOIN bill_items bi ON bi.bill_id = b.id
     WHERE b.patient_id = $1 AND b.deleted_at IS NULL
     GROUP BY b.id, u.first_name, u.last_name
     ORDER BY b.created_at DESC`,
    [patientId]
  );
  return bills;
}

// ---------------------------------------------------------------------------
// List all bills (admin)
// ---------------------------------------------------------------------------
export async function listAllBills(filters = {}) {
  const { page = 1, limit = 50, status, patientId } = filters;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE b.deleted_at IS NULL';
  const params = [];
  let paramCount = 0;
  
  if (status) {
    paramCount++;
    whereClause += ` AND b.status = $${paramCount}`;
    params.push(status);
  }
  
  if (patientId) {
    paramCount++;
    whereClause += ` AND b.patient_id = $${paramCount}`;
    params.push(patientId);
  }
  
  paramCount++;
  const limitParam = paramCount;
  paramCount++;
  const offsetParam = paramCount;
  params.push(limit, offset);
  
  const { rows: bills } = await pool.query(
    `SELECT b.*,
            p.first_name || ' ' || p.last_name AS patient_name,
            p.mrn,
            u.first_name || ' ' || u.last_name AS issued_by_name,
            COUNT(*) OVER() AS total_count
     FROM bills b
     LEFT JOIN patients p ON p.id = b.patient_id
     LEFT JOIN users u ON u.id = b.issued_by
     ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  
  const total = bills[0]?.total_count ?? 0;
  return {
    bills: bills.map(({ total_count, ...bill }) => bill),
    total: parseInt(total, 10),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };
}

// ---------------------------------------------------------------------------
// Get single bill
// ---------------------------------------------------------------------------
export async function getBillById(id) {
  const { rows } = await pool.query(
    `SELECT b.*,
            p.first_name || ' ' || p.last_name AS patient_name,
            p.mrn,
            u.first_name || ' ' || u.last_name AS issued_by_name,
            COALESCE(
              json_agg(bi ORDER BY bi.created_at) FILTER (WHERE bi.id IS NOT NULL),
              '[]'
            ) AS items,
            COALESCE(
              (SELECT json_agg(py ORDER BY py.created_at)
               FROM payments py WHERE py.bill_id = b.id),
              '[]'
            ) AS payments
     FROM bills b
     JOIN patients p ON p.id = b.patient_id
     LEFT JOIN users u ON u.id = b.issued_by
     LEFT JOIN bill_items bi ON bi.bill_id = b.id
     WHERE b.id = $1 AND b.deleted_at IS NULL
     GROUP BY b.id, p.first_name, p.last_name, p.mrn, u.first_name, u.last_name`,
    [id]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------
export async function recordPayment({ billId, amount, paymentMethod, referenceNo, processedBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [bill] } = await client.query(
      `SELECT * FROM bills WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [billId]
    );
    if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }
    if (bill.status === 'PAID') { const e = new Error('Bill already paid'); e.status = 400; throw e; }
    if (bill.status === 'REFUNDED') { const e = new Error('Bill has been refunded'); e.status = 400; throw e; }

    // Sum existing completed payments
    const { rows: [{ paid }] } = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS paid FROM payments
       WHERE bill_id = $1 AND status = 'COMPLETED'`,
      [billId]
    );

    const remaining = +(bill.net_amount - paid).toFixed(2);
    if (amount > remaining + 0.01) {
      const e = new Error(`Payment amount exceeds outstanding balance of ${remaining}`);
      e.status = 400;
      throw e;
    }

    const { rows: [payment] } = await client.query(
      `INSERT INTO payments
         (bill_id, patient_id, amount, method, reference_no, status, processed_by, processed_at)
       VALUES ($1,$2,$3,$4,$5,'COMPLETED',$6,NOW())
       RETURNING *`,
      [billId, bill.patient_id, amount, paymentMethod, referenceNo ?? null, processedBy]
    );

    // Determine new bill status
    const newPaid   = +(+paid + amount).toFixed(2);
    const newStatus = newPaid >= bill.net_amount - 0.01 ? 'PAID' : 'PARTIALLY_PAID';

    await client.query(
      `UPDATE bills SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, billId]
    );

    await client.query('COMMIT');
    await auditLog(processedBy, 'CREATE', 'payments', payment.id, null, payment);
    await auditLog(processedBy, 'UPDATE', 'bills', billId, { status: bill.status }, { status: newStatus });
    return { payment, billStatus: newStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------
export async function refundBill({ billId, reason, amount, processedBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [bill] } = await client.query(
      `SELECT * FROM bills WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [billId]
    );
    if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }
    if (!['PAID','PARTIALLY_PAID'].includes(bill.status)) {
      const e = new Error('Only paid bills can be refunded'); e.status = 400; throw e;
    }

    const refundAmount = amount ?? bill.net_amount;

    await client.query(
      `INSERT INTO payments
         (bill_id, patient_id, amount, method, reference_no, status, processed_by, processed_at)
       VALUES ($1,$2,$3,'REFUND',$4,'COMPLETED',$5,NOW())`,
      [billId, bill.patient_id, refundAmount, `REFUND: ${reason}`, processedBy]
    );

    await client.query(
      `UPDATE bills SET status = 'REFUNDED', notes = COALESCE(notes,'') || $1, updated_at = NOW()
       WHERE id = $2`,
      [`\n[REFUND] ${reason}`, billId]
    );

    await client.query('COMMIT');
    await auditLog(processedBy, 'CREATE', 'payments', null, null, { billId, refundAmount, reason });
    await auditLog(processedBy, 'UPDATE', 'bills', billId, { status: bill.status }, { status: 'REFUNDED', refundAmount, reason });
    return { refunded: true, amount: refundAmount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Attach insurance claim
// ---------------------------------------------------------------------------
export async function attachInsuranceClaim({ billId, insurancePolicyId, claimAmount, claimReference, notes, processedBy }) {
  const { rows: [policy] } = await pool.query(
    `SELECT * FROM insurance_policies WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
    [insurancePolicyId]
  );
  if (!policy) { const e = new Error('Insurance policy not found or inactive'); e.status = 404; throw e; }

  const { rows: [bill] } = await pool.query(
    `UPDATE bills
     SET insurance_policy_id = $1,
         insurance_claim_ref = $2,
         insurance_claim_amount = $3,
         insurance_notes = $4,
         updated_at = NOW()
     WHERE id = $5 AND deleted_at IS NULL
     RETURNING *`,
    [insurancePolicyId, claimReference ?? null, claimAmount, notes ?? null, billId]
  );
  if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }
  await auditLog(processedBy, 'UPDATE', 'bills', bill.id, null, bill);
  return bill;
}

// ---------------------------------------------------------------------------
// Insurance CRUD
// ---------------------------------------------------------------------------
export async function createInsurance({ patientId, provider, policyNumber, groupNumber,
  coverageType, coverageAmount, validFrom, validUntil, copayPct, isPrimary }) {
  const { rows: [policy] } = await pool.query(
    `INSERT INTO insurance_policies
       (patient_id, provider_name, policy_number, group_number, coverage_type,
        max_coverage_amount, coverage_start, coverage_end, copay_pct, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [patientId, provider, policyNumber, groupNumber ?? null, coverageType,
     coverageAmount, validFrom, validUntil, copayPct ?? 0, isPrimary ?? true]
  );
  await auditLog(patientId, 'CREATE', 'insurance_policies', policy.id, null, policy);
  return policy;
}

export async function getInsuranceByPatient(patientId) {
  const { rows } = await pool.query(
    `SELECT * FROM insurance_policies
     WHERE patient_id = $1 AND deleted_at IS NULL
     ORDER BY is_primary DESC, created_at DESC`,
    [patientId]
  );
  return rows;
}

export async function updateInsurance(id, updates) {
  const fields = [];
  const vals   = [];
  let   idx    = 1;

  if (updates.provider       != null) { fields.push(`provider_name = $${idx++}`);       vals.push(updates.provider); }
  if (updates.policyNumber   != null) { fields.push(`policy_number = $${idx++}`);       vals.push(updates.policyNumber); }
  if (updates.coverageAmount != null) { fields.push(`max_coverage_amount = $${idx++}`); vals.push(updates.coverageAmount); }
  if (updates.validUntil     != null) { fields.push(`coverage_end = $${idx++}`);        vals.push(updates.validUntil); }
  if (updates.isActive       != null) { fields.push(`is_active = $${idx++}`);           vals.push(updates.isActive); }
  if (updates.copayPct       != null) { fields.push(`copay_pct = $${idx++}`);           vals.push(updates.copayPct); }

  if (!fields.length) { const e = new Error('No fields to update'); e.status = 400; throw e; }

  fields.push(`updated_at = NOW()`);
  vals.push(id);

  const { rows: [prev] } = await pool.query(
    `SELECT * FROM insurance_policies WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { rows: [policy] } = await pool.query(
    `UPDATE insurance_policies SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`,
    vals
  );
  if (!policy) { const e = new Error('Insurance policy not found'); e.status = 404; throw e; }
  await auditLog(id, 'UPDATE', 'insurance_policies', policy.id, prev, policy);
  return policy;
}

export async function deleteInsurance(id) {
  const { rows: [prev] } = await pool.query(
    `SELECT * FROM insurance_policies WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { rows: [policy] } = await pool.query(
    `UPDATE insurance_policies SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (!policy) { const e = new Error('Insurance policy not found'); e.status = 404; throw e; }
  await auditLog(id, 'UPDATE', 'insurance_policies', policy.id, prev, { deleted: true });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Flag bill for discount approval
// ---------------------------------------------------------------------------
export async function flagForDiscountApproval(billId) {
  await pool.query(
    `UPDATE bills SET discount_approved = FALSE, updated_at = NOW() WHERE id = $1`,
    [billId]
  );
  await auditLog(billId, 'UPDATE', 'bills', billId, null, { discount_approved: false });
}

// ---------------------------------------------------------------------------
// Financial summary (admin)
// ---------------------------------------------------------------------------
export async function getFinancialSummary({ date }) {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  const [daily, outstanding, methodBreakdown] = await Promise.all([
    // Daily collections
    pool.query(
      `SELECT
         DATE(py.processed_at) AS day,
         SUM(py.amount) FILTER (WHERE py.method != 'REFUND') AS collected,
         SUM(py.amount) FILTER (WHERE py.method = 'REFUND')  AS refunded,
         COUNT(DISTINCT py.bill_id) AS transactions
       FROM payments py
       WHERE py.status = 'COMPLETED'
         AND DATE(py.processed_at) = $1
       GROUP BY DATE(py.processed_at)`,
      [targetDate]
    ),
    // Outstanding bills
    pool.query(
      `SELECT b.id, b.bill_number, b.net_amount, b.status, b.due_date,
              p.first_name || ' ' || p.last_name AS patient_name, p.mrn,
              COALESCE(SUM(py.amount) FILTER (WHERE py.status='COMPLETED' AND py.method!='REFUND'),0) AS paid_amount
       FROM bills b
       JOIN patients p ON p.id = b.patient_id
       LEFT JOIN payments py ON py.bill_id = b.id
       WHERE b.status IN ('ISSUED','PARTIALLY_PAID') AND b.deleted_at IS NULL
       GROUP BY b.id, p.first_name, p.last_name, p.mrn
       ORDER BY b.due_date ASC NULLS LAST
       LIMIT 100`
    ),
    // Payment method breakdown (last 30 days)
    pool.query(
      `SELECT method, SUM(amount) AS total, COUNT(*) AS count
       FROM payments
       WHERE status = 'COMPLETED' AND method != 'REFUND'
         AND processed_at >= NOW() - INTERVAL '30 days'
       GROUP BY method`
    ),
  ]);

  return {
    daily        : daily.rows[0] ?? { collected: 0, refunded: 0, transactions: 0 },
    outstanding  : outstanding.rows,
    methodBreakdown: methodBreakdown.rows,
  };
}

// ---------------------------------------------------------------------------
// Razorpay helpers (server-side only — uses Node native fetch)
// ---------------------------------------------------------------------------
async function razorpayFetch(method, path, body) {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw Object.assign(new Error('Razorpay credentials not configured'), { status: 503 });
  }

  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      'Content-Type' : 'application/json',
      'Authorization': `Basic ${credentials}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.description ?? 'Razorpay API error');
    err.status = res.status;
    throw err;
  }
  return data;
}

function generateSignature(orderId, paymentId) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new Error('RAZORPAY_KEY_SECRET not set');
  return createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a ?? '', 'utf8');
  const bufB = Buffer.from(b ?? '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Create Razorpay order for a bill
// ---------------------------------------------------------------------------
export async function createRazorpayOrder(billId) {
  const bill = await getBillById(billId);
  if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }
  if (!['ISSUED', 'PARTIALLY_PAID'].includes(bill.status)) {
    const e = new Error(`Cannot pay bill with status '${bill.status}'`);
    e.status = 400;
    throw e;
  }

  const paid = (bill.payments ?? [])
    .filter((p) => p.status === 'COMPLETED' && p.method !== 'REFUND')
    .reduce((s, p) => s + +p.amount, 0);
  const outstanding = Math.max(0, +bill.net_amount - paid);

  if (outstanding <= 0) {
    const e = new Error('Bill is already fully paid');
    e.status = 400;
    throw e;
  }

  const amountPaise = Math.round(outstanding * 100);
  if (amountPaise < 100) {
    const e = new Error('Payment amount must be at least ₹1.00');
    e.status = 400;
    throw e;
  }

  const order = await razorpayFetch('POST', '/orders', {
    amount       : amountPaise,
    currency     : 'INR',
    receipt      : `bill_${billId}`,
    notes        : { bill_id: billId, bill_number: bill.bill_number },
    partial_payment: false,
  });

  return {
    orderId  : order.id,
    amount   : order.amount,
    currency : order.currency,
    key      : process.env.RAZORPAY_KEY_ID,
  };
}

// ---------------------------------------------------------------------------
// Verify Razorpay payment and record it
// ---------------------------------------------------------------------------
export async function verifyAndRecordRazorpayPayment({ billId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const expectedSig = generateSignature(razorpayOrderId, razorpayPaymentId);
  if (!safeEqual(expectedSig, razorpaySignature)) {
    const e = new Error('Payment verification failed — signature mismatch');
    e.status = 400;
    throw e;
  }

  const bill = await getBillById(billId);
  if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }

  const paid = (bill.payments ?? [])
    .filter((p) => p.status === 'COMPLETED' && p.method !== 'REFUND')
    .reduce((s, p) => s + +p.amount, 0);
  const outstanding = Math.max(0, +bill.net_amount - paid);

  return recordPayment({
    billId,
    amount      : outstanding,
    paymentMethod: 'ONLINE',
    referenceNo : razorpayPaymentId,
    processedBy : bill.patient_id,
  });
}

// ---------------------------------------------------------------------------
// Discount approval (admin)
// ---------------------------------------------------------------------------
export async function approveDiscount({ billId, approved, note, adminId }) {
  const { rows: [bill] } = await pool.query(
    `UPDATE bills
     SET discount_approved = $1,
         discount_approved_by = $2,
         discount_note = $3,
         updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [approved, adminId, note ?? null, billId]
  );
  if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }
  await auditLog(adminId, 'UPDATE', 'bills', bill.id, null, bill);
  return bill;
}
