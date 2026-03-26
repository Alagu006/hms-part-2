import * as svc from './incident.service.js';

export async function createIncident(req, res, next) {
  try {
    const result = await svc.createIncident(req.body, req.user.id, req.app.get('io'), req.ip);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getIncidents(req, res, next) {
  try {
    const rows = await svc.getIncidents(req.query);
    res.json(rows);
  } catch (err) { next(err); }
}
