import * as adminService from './admin.service.js';
import { auditLog } from '../../shared/middleware/audit.js';

export async function getStats(req, res, next) {
  try {
    const stats = await adminService.getStats();
    res.json(stats);
  } catch (err) { next(err); }
}

export async function getAuditLogs(req, res, next) {
  try {
    const result = await adminService.getAuditLogs(req.query);
    res.json(result);
  } catch (err) { next(err); }
}

export async function verifyAuditChain(req, res, next) {
  try {
    const result = await adminService.verifyAuditChain();
    res.json(result);
  } catch (err) { next(err); }
}

export async function getUsers(req, res, next) {
  try {
    const users = await adminService.getUsers(req.query);
    res.json(users);
  } catch (err) { next(err); }
}

export async function setUserStatus(req, res, next) {
  try {
    const { id }      = req.params;
    const { isActive } = req.body;
    const prev = { isActive: !isActive };
    const result = await adminService.setUserStatus(id, isActive, req.user.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'UPDATE',
      entity  : 'users',
      entityId: id,
      prevData: prev,
      nextData: { isActive },
      ip      : req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getSessions(req, res, next) {
  try {
    const sessions = await adminService.getActiveSessions();
    res.json(sessions);
  } catch (err) { next(err); }
}

export async function deleteSession(req, res, next) {
  try {
    const result = await adminService.forceLogout(req.params.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'FORCE_LOGOUT',
      entity  : 'sessions',
      entityId: req.params.id,
      nextData: result,
      ip      : req.ip,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}
