import * as svc from './case-notes.service.js';

export async function listCaseNotes(req, res, next) {
  try {
    const rows = await svc.listCaseNotes(req.parsedQuery ?? req.query);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createCaseNote(req, res, next) {
  try {
    const note = await svc.createCaseNote(req.body, req.user.id);
    res.status(201).json(note);
  } catch (err) { next(err); }
}

export async function updateCaseNote(req, res, next) {
  try {
    const note = await svc.updateCaseNote(req.params.id, req.body, req.user.id);
    res.json(note);
  } catch (err) { next(err); }
}
