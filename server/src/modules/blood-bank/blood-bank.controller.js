import * as svc from './blood-bank.service.js';

export async function createBloodUnit(req, res, next) {
  try {
    const result = await svc.createBloodUnit(req.body, req.user.id, req.ip);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getBloodUnits(req, res, next) {
  try {
    const rows = await svc.getBloodUnits(req.query);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getBloodUnit(req, res, next) {
  try {
    const row = await svc.getBloodUnit(req.params.id);
    res.json(row);
  } catch (err) { next(err); }
}

export async function updateBloodUnit(req, res, next) {
  try {
    const result = await svc.updateBloodUnit(req.params.id, req.body, req.user.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
}

export async function deleteBloodUnit(req, res, next) {
  try {
    const result = await svc.deleteBloodUnit(req.params.id, req.user.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
}

export async function requestBlood(req, res, next) {
  try {
    const result = await svc.requestBlood(req.body, req.user.id, req.app.get('io'), req.ip);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getAvailability(req, res, next) {
  try {
    const result = await svc.getAvailability();
    res.json(result);
  } catch (err) { next(err); }
}
