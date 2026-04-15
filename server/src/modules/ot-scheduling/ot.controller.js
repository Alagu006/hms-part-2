import * as svc from './ot.service.js';

export async function createOTSchedule(req, res, next) {
  try {
    const result = await svc.createOTSchedule(req.body, req.user.id, req.app.get('io'), req.ip);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getOTSchedules(req, res, next) {
  try {
    const rows = await svc.getOTSchedules((req.parsedQuery ?? req.query));
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getOTSchedule(req, res, next) {
  try {
    const row = await svc.getOTSchedule(req.params.id);
    res.json(row);
  } catch (err) { next(err); }
}

export async function updateOTSchedule(req, res, next) {
  try {
    const result = await svc.updateOTSchedule(req.params.id, req.body, req.user.id, req.app.get('io'), req.ip);
    res.json(result);
  } catch (err) { next(err); }
}

export async function deleteOTSchedule(req, res, next) {
  try {
    const result = await svc.deleteOTSchedule(req.params.id, req.user.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
}
