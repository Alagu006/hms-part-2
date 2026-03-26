import * as svc from './telemedicine.service.js';

export async function createSession(req, res) {
  try {
    const io      = req.app.get('io');
    const session = await svc.createSession(
      req.body,
      req.user.id,
      req.ip,
      req.headers['user-agent'],
      io
    );
    res.status(201).json({ data: session });
  } catch (err) {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message });
  }
}

export async function listMySessions(req, res) {
  try {
    const result = await svc.listMySessions(
      req.user.id,
      req.user.roles,
      req.query
    );
    res.json({ data: result });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
}

export async function getRoomToken(req, res) {
  try {
    const token = await svc.getRoomToken(
      req.params.id,
      req.user.id,
      req.user.roles
    );
    res.json({ data: token });
  } catch (err) {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message, code: err.code });
  }
}

export async function endSession(req, res) {
  try {
    const result = await svc.endSession(
      req.params.id,
      req.user.id,
      req.body,
      req.ip,
      req.headers['user-agent']
    );
    res.json({ data: result });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
}
