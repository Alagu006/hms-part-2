import * as svc from './discharge.service.js';

export async function createDischargeSummary(req, res, next) {
  try {
    const result = await svc.createDischargeSummary(req.body, req.user.id, req.app.get('io'), req.ip);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getPatientDischargeSummaries(req, res, next) {
  try {
    const rows = await svc.getPatientDischargeSummaries(req.params.patientId);
    res.json(rows);
  } catch (err) { next(err); }
}
