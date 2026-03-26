import * as svc from './prescription.service.js';

export async function searchMedicines(req, res, next) {
  try {
    const results = await svc.searchMedicines(req.query.q);
    return res.status(200).json({ data: results });
  } catch (err) { next(err); }
}

export async function createPrescription(req, res, next) {
  try {
    const result = await svc.createPrescription(
      req.body, req.user.id, req.ip, req.headers['user-agent']
    );
    return res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPrescription(req, res, next) {
  try {
    const result = await svc.getPrescriptionById(req.params.id, req.user);
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    if (!result)                return res.status(404).json({ error: 'Prescription not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPatientPrescriptions(req, res, next) {
  try {
    const result = await svc.getPatientPrescriptions(req.params.patientId, req.query);
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function dispensePrescription(req, res, next) {
  try {
    const result = await svc.dispensePrescription(
      req.params.id, req.body, req.user.id, req.ip, req.headers['user-agent']
    );
    if (!result) return res.status(404).json({ error: 'Prescription not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPrescriptionCount(req, res, next) {
  try {
    const count = await svc.countPrescriptions(req.query, req.user.id);
    return res.status(200).json({ count });
  } catch (err) { next(err); }
}

export async function listPrescriptions(req, res, next) {
  try {
    const result = await svc.listPrescriptions(req.query);
    return res.status(200).json(result);
  } catch (err) { next(err); }
}
