import * as svc from './broadcast.service.js';

// io is injected via req.app.get('io') — set in app.js: app.set('io', io)

export async function createBroadcast(req, res, next) {
  try {
    const io     = req.app.get('io');
    const result = await svc.createBroadcast(
      req.body,
      req.user.id,
      req.ip,
      req.headers['user-agent'],
      io
    );
    return res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

export async function listBroadcasts(req, res, next) {
  try {
    const result = await svc.listBroadcasts(req.query);
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function getBroadcast(req, res, next) {
  try {
    const result = await svc.getBroadcastById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Broadcast not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function getReadReceipts(req, res, next) {
  try {
    const result = await svc.getReadReceipts(req.params.id, req.query);
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function getStaffCount(req, res, next) {
  try {
    const count = await svc.getStaffCount();
    return res.status(200).json({ count });
  } catch (err) { next(err); }
}
