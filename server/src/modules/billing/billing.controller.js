import * as svc from './billing.service.js';
import { auditLog } from '../../shared/middleware/audit.js';
import { generatePdf } from '../../shared/utils/pdf.service.js';

export async function createRazorpayOrderHandler(req, res, next) {
  try {
    const result = await svc.createRazorpayOrder(req.params.id);
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function verifyRazorpayPaymentHandler(req, res, next) {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const result = await svc.verifyAndRecordRazorpayPayment({
      billId            : req.params.id,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    await auditLog({
      userId  : req.user?.id ?? req.body?.razorpayPaymentId,
      action  : 'PAYMENT',
      entity  : 'bills',
      entityId: req.params.id,
      nextData: { amount: result.payment?.amount, method: 'ONLINE', razorpayPaymentId, newStatus: result.billStatus },
      ip      : req.ip,
    });

    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function getPendingServicesHandler(req, res, next) {
  try {
    const data = await svc.getPendingServices(req.params.patientId);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function createBillHandler(req, res, next) {
  try {
    const { patientId, items, taxPercent, notes, dueDate } = req.body;

    // Flag bills with any item discount > 20% — requires admin approval
    const needsApproval = items.some((i) => (i.discount ?? 0) > 20);

    const bill = await svc.createBill({
      patientId, items, taxPercent, notes, dueDate,
      issuedBy: req.user.id,
    });

    if (needsApproval) {
      await svc.flagForDiscountApproval(bill.id);
    }

    await auditLog({
      userId  : req.user.id,
      action  : 'CREATE',
      entity  : 'bills',
      entityId: bill.id,
      nextData: { patientId, totalAmount: bill.net_amount, needsApproval },
      ip      : req.ip,
    });

    res.status(201).json({ data: bill, needsApproval });
  } catch (err) { next(err); }
}

export async function getBillsByPatientHandler(req, res, next) {
  try {
    const bills = await svc.getBillsByPatient(req.params.patientId);
    res.json({ data: bills });
  } catch (err) { next(err); }
}

export async function listAllBillsHandler(req, res, next) {
  try {
    const bills = await svc.listAllBills(req.query);
    res.json({ data: bills });
  } catch (err) { next(err); }
}

export async function getBillHandler(req, res, next) {
  try {
    const bill = await svc.getBillById(req.params.id);
    if (!bill) { const e = new Error('Bill not found'); e.status = 404; throw e; }
    res.json({ data: bill });
  } catch (err) { next(err); }
}

export async function payBillHandler(req, res, next) {
  try {
    const { amount, paymentMethod, referenceNo, razorpayOrderId, razorpayPaymentId } = req.body;

    const result = await svc.recordPayment({
      billId       : req.params.id,
      amount,
      paymentMethod,
      referenceNo  : referenceNo ?? razorpayPaymentId ?? null,
      processedBy  : req.user.id,
    });

    await auditLog({
      userId  : req.user.id,
      action  : 'PAYMENT',
      entity  : 'bills',
      entityId: req.params.id,
      nextData: { amount, paymentMethod, newStatus: result.billStatus },
      ip      : req.ip,
    });

    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function refundBillHandler(req, res, next) {
  try {
    const { reason, amount } = req.body;
    const result = await svc.refundBill({
      billId     : req.params.id,
      reason,
      amount,
      processedBy: req.user.id,
    });

    await auditLog({
      userId  : req.user.id,
      action  : 'REFUND',
      entity  : 'bills',
      entityId: req.params.id,
      nextData: { reason, amount },
      ip      : req.ip,
    });

    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function insuranceClaimHandler(req, res, next) {
  try {
    const bill = await svc.attachInsuranceClaim({
      billId           : req.params.id,
      ...req.body,
      processedBy      : req.user.id,
    });
    res.json({ data: bill });
  } catch (err) { next(err); }
}

// Insurance CRUD
export async function createInsuranceHandler(req, res, next) {
  try {
    const policy = await svc.createInsurance(req.body);
    await auditLog({ userId: req.user.id, action: 'CREATE', entity: 'insurance_policies',
      entityId: policy.id, nextData: req.body, ip: req.ip });
    res.status(201).json({ data: policy });
  } catch (err) { next(err); }
}

export async function getInsuranceHandler(req, res, next) {
  try {
    const policies = await svc.getInsuranceByPatient(req.params.patientId);
    res.json({ data: policies });
  } catch (err) { next(err); }
}

export async function updateInsuranceHandler(req, res, next) {
  try {
    const policy = await svc.updateInsurance(req.params.id, req.body);
    res.json({ data: policy });
  } catch (err) { next(err); }
}

export async function deleteInsuranceHandler(req, res, next) {
  try {
    const result = await svc.deleteInsurance(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
}

// Financial summary
export async function financialSummaryHandler(req, res, next) {
  try {
    const data = await svc.getFinancialSummary({ date: req.query.date });
    res.json({ data });
  } catch (err) { next(err); }
}

// Discount approval
export async function approveDiscountHandler(req, res, next) {
  try {
    const bill = await svc.approveDiscount({
      billId : req.params.id,
      ...req.body,
      adminId: req.user.id,
    });
    res.json({ data: bill });
  } catch (err) { next(err); }
}

export async function downloadBillPdf(req, res, next) {
  try {
    const bill = await svc.getBillById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const items = bill.items ?? [];
    const payments = bill.payments ?? [];

    const issuedDate = new Date(bill.issued_at).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const statusBadge = {
      PAID: { bg: '#d1fae5', color: '#065f46', text: 'PAID' },
      PARTIALLY_PAID: { bg: '#fef3c7', color: '#92400e', text: 'PARTIALLY PAID' },
      ISSUED: { bg: '#dbeafe', color: '#1e40af', text: 'ISSUED' },
      OVERDUE: { bg: '#fee2e2', color: '#991b1b', text: 'OVERDUE' },
      REFUNDED: { bg: '#f3f4f6', color: '#6b7280', text: 'REFUNDED' },
    }[bill.status] ?? { bg: '#f3f4f6', color: '#374151', text: bill.status };

    const itemsRows = items.map(item => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${item.description ?? '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${item.quantity ?? 0}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">₹${(+item.unit_price ?? 0).toFixed(2)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">₹${(+item.total_price ?? 0).toFixed(2)}</td>
      </tr>`).join('');

    const subtotal = items.reduce((s, i) => s + (+i.total_price ?? 0), 0);
    const taxAmount = +bill.tax_amount ?? 0;
    const netAmount = +bill.net_amount ?? 0;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Bill ${bill.bill_number}</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:13px;color:#111;">
<div style="max-width:800px;margin:0 auto;padding:20px 30px;">

  <!-- Header -->
  <div style="border-bottom:3px solid #1a56db;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <h1 style="margin:0;font-size:22px;color:#1a56db;">${process.env.HMS_NAME || 'Hospital Management System'}</h1>
      <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">${process.env.HMS_ADDRESS || ''}</p>
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:12px;color:#374151;"><strong>INVOICE / BILL</strong></p>
      <p style="margin:2px 0 0;font-size:11px;color:#6b7280;">Bill No: ${bill.bill_number}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#6b7280;">Date: ${issuedDate}</p>
    </div>
  </div>

  <!-- Patient Info -->
  <div style="display:flex;justify-content:space-between;margin-bottom:24px;gap:20px;">
    <div style="flex:1;background:#f3f8ff;border-radius:6px;padding:12px;">
      <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Patient</p>
      <p style="margin:0;font-size:14px;font-weight:600;">${bill.patient_name ?? '—'}</p>
      <p style="margin:2px 0 0;font-size:12px;color:#374151;">MRN: ${bill.mrn ?? '—'}</p>
    </div>
    <div style="text-align:right;">
      <span style="display:inline-block;padding:4px 14px;border-radius:999px;font-size:12px;font-weight:700;background:${statusBadge.bg};color:${statusBadge.color};">
        ${statusBadge.text}
      </span>
    </div>
  </div>

  <!-- Items Table -->
  <div style="margin-bottom:20px;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Description</th>
          <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;text-align:center;">Qty</th>
          <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;text-align:right;">Unit Price</th>
          <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>
  </div>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
    <table style="width:280px;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="padding:8px 12px;color:#6b7280;">Subtotal</td>
        <td style="padding:8px 12px;text-align:right;font-weight:600;">₹${subtotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#6b7280;">Tax (GST)</td>
        <td style="padding:8px 12px;text-align:right;font-weight:600;">₹${taxAmount.toFixed(2)}</td>
      </tr>
      <tr style="border-top:2px solid #1a56db;">
        <td style="padding:10px 12px;font-weight:700;font-size:15px;">Grand Total</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:15px;color:#1a56db;">₹${netAmount.toFixed(2)}</td>
      </tr>
    </table>
  </div>

  ${payments.length > 0 ? `
  <!-- Payments -->
  <div style="margin-bottom:20px;">
    <h3 style="margin:0 0 10px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:6px;">Payment History</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date</th>
          <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Method</th>
          <th style="text-align:right;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${payments.map(p => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;">${new Date(p.processed_at).toLocaleDateString('en-IN')}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;">${p.method ?? '—'}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">₹${(+p.amount ?? 0).toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Footer -->
  <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#6b7280;">Thank you for choosing our hospital.</p>
    <p style="margin:4px 0 0;font-size:10px;color:#9ca3af;font-style:italic;">For queries, contact us at ${process.env.HMS_CONTACT || ''}</p>
  </div>
</div>
</body>
</html>`;

    const buffer = await generatePdf(html);
    const filename = `bill_${bill.bill_number}_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    if (err?.code === 'PDF_UNAVAILABLE' || err?.code === 'PDF_GENERATION_FAILED') {
      return res.status(err.status ?? 500).json({ error: err.message });
    }
    next(err);
  }
}
