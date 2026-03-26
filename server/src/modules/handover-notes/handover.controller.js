import * as svc from './handover.service.js';

export async function listHandover(req, res, next) {
  try {
    const result = await svc.listHandoverNotes(req.query);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function createHandover(req, res, next) {
  try {
    const note = await svc.createHandoverNote(req.body, req.user.id);
    return res.status(201).json({ data: note });
  } catch (err) {
    next(err);
  }
}

export async function markHandoverRead(req, res, next) {
  try {
    const note = await svc.markRead(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    return res.status(200).json({ data: note });
  } catch (err) {
    next(err);
  }
}
