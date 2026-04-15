import * as svc from './inventory.service.js';

const ok  = (res, data, status = 200) => res.status(status).json({ data });
const err = (res, e)                  => res.status(e.status ?? 500).json({ error: e.message });

export async function createItem(req, res) {
  try { ok(res, await svc.createItem(req.body, req.user.id, req.ip, req.headers['user-agent']), 201); }
  catch (e) { err(res, e); }
}

export async function listItems(req, res) {
  try { ok(res, await svc.listItems((req.parsedQuery ?? req.query))); }
  catch (e) { err(res, e); }
}

export async function getItem(req, res) {
  try {
    const item = await svc.getItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    ok(res, item);
  } catch (e) { err(res, e); }
}

export async function updateItem(req, res) {
  try {
    const item = await svc.updateItem(req.params.id, req.body, req.user.id, req.ip, req.headers['user-agent']);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    ok(res, item);
  } catch (e) { err(res, e); }
}

export async function deleteItem(req, res) {
  try {
    const item = await svc.deleteItem(req.params.id, req.user.id, req.ip, req.headers['user-agent']);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    ok(res, { deleted: true });
  } catch (e) { err(res, e); }
}

export async function adjustQuantity(req, res) {
  try {
    const io   = req.app.get('io');
    const item = await svc.adjustQuantity(
      req.params.id, req.body.adjustment, req.body.reason,
      req.user.id, req.ip, req.headers['user-agent'], io
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    ok(res, item);
  } catch (e) { err(res, e); }
}

export async function getBeds(req, res) {
  try { ok(res, await svc.getBedMatrix()); }
  catch (e) { err(res, e); }
}

export async function createRoom(req, res) {
  try {
    const room = await svc.createRoom(req.body, req.user.id, req.ip, req.headers['user-agent']);
    ok(res, room, 201);
  } catch (e) { err(res, e); }
}

export async function createBed(req, res) {
  try {
    const bed = await svc.createBed(
      { roomId: req.params.roomId, bedNumber: req.body.bedNumber },
      req.user.id, req.ip, req.headers['user-agent']
    );
    if (!bed) return res.status(404).json({ error: 'Room not found' });
    ok(res, bed, 201);
  } catch (e) { err(res, e); }
}

export async function updateBed(req, res) {
  try {
    const bed = await svc.updateBedStatus(req.params.id, req.body, req.user.id, req.ip, req.headers['user-agent']);
    if (!bed) return res.status(404).json({ error: 'Bed not found' });
    ok(res, bed);
  } catch (e) { err(res, e); }
}

export async function generateQr(req, res) {
  try {
    const result = await svc.generateQrData(req.body.itemId, req.user.id, req.ip, req.headers['user-agent']);
    if (!result) return res.status(404).json({ error: 'Item not found' });
    ok(res, result);
  } catch (e) { err(res, e); }
}

export async function lookupQr(req, res) {
  try {
    const item = await svc.lookupByQrCode(req.params.code);
    if (!item) return res.status(404).json({ error: 'Invalid or unrecognised QR code' });
    ok(res, item);
  } catch (e) { err(res, e); }
}

export async function getAlerts(req, res) {
  try { ok(res, await svc.getAlerts()); }
  catch (e) { err(res, e); }
}

export async function getStats(req, res) {
  try { ok(res, await svc.getStats()); }
  catch (e) { err(res, e); }
}

export async function importCsv(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
    const results = await svc.importFromCsv(
      req.file.buffer, req.user.id, req.ip, req.headers['user-agent']
    );
    ok(res, results);
  } catch (e) { err(res, e); }
}
