import * as svc from './billing.service.js';
import { auditLog } from '../../shared/middleware/audit.js';

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
