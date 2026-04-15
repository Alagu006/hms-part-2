import * as svc from './lab-orders.service.js';

export async function listLabOrders(req, res, next) {
  try {
    const result = await svc.listLabOrders(req.parsedQuery ?? req.query);
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function createLabOrder(req, res, next) {
  try {
    const io    = req.app.get('io');
    const order = await svc.createLabOrder(req.body, req.user.id, io);
    return res.status(201).json({ data: order });
  } catch (err) { next(err); }
}

export async function updateLabOrder(req, res, next) {
  try {
    const order = await svc.updateLabOrder(req.params.id, req.body);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    return res.status(200).json({ data: order });
  } catch (err) { next(err); }
}

export async function createLabResult(req, res, next) {
  try {
    const io     = req.app.get('io');
    const result = await svc.createLabResult(req.body, req.user.id, io);
    return res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

export async function getLabResult(req, res, next) {
  try {
    const result = await svc.getLabResultById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Lab result not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPatientLabResults(req, res, next) {
  try {
    const { patientId } = req.params;

    // Patients can only view their own results
    if (req.user.roles.includes('PATIENT')) {
      const { rows } = await import('../../shared/db/pool.js').then(m =>
        m.query(`SELECT id FROM patients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [patientId, req.user.id])
      );
      if (!rows[0]) return res.status(403).json({ error: 'Access denied' });
    }

    const { page = 1, limit = 50 } = req.query;
    const result = await svc.getPatientLabResults(patientId, {
      page : parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    return res.status(200).json(result);
  } catch (err) { next(err); }
}
