import * as svc from './vitals.service.js';

export async function recordVitals(req, res, next) {
  try {
    const result = await svc.recordVitals(
      req.body, req.user.id, req.ip, req.headers['user-agent']
    );
    return res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

export async function getVitalsHistory(req, res, next) {
  try {
    const result = await svc.getVitalsHistory(
      req.params.patientId, req.user, req.query
    );
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getVitalsCount(req, res, next) {
  try {
    const filters = { ...(req.parsedQuery ?? req.query) };
    if (filters.nurseId === 'me') filters.nurseId = req.user.id;
    const count = await svc.countVitalsToday(filters);
    return res.status(200).json({ count });
  } catch (err) {
    next(err);
  }
}
