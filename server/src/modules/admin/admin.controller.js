import * as adminService from './admin.service.js';
import { auditLog } from '../../shared/middleware/audit.js';

export async function createUser(req, res, next) {
  try {
    const user = await adminService.createUser(req.body, req.user.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'CREATE',
      entity  : 'users',
      entityId: user.id,
      nextData: { role: user.role, employeeId: user.employee_id },
      ip      : req.ip,
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
}


export async function getStats(req, res, next) {
  try {
    const stats = await adminService.getStats();
    res.json(stats);
  } catch (err) { next(err); }
}

export async function getAuditLogs(req, res, next) {
  try {
    const result = await adminService.getAuditLogs((req.parsedQuery ?? req.query));
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
    const users = await adminService.getUsers((req.parsedQuery ?? req.query));
    res.json(users);
  } catch (err) { next(err); }
}

export async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const prev = await adminService.getUsers({ search: id, limit: 1 }).then(r => r[0]);
    const result = await adminService.updateUser(id, req.body, req.user.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'UPDATE',
      entity  : 'users',
      entityId: id,
      prevData: prev ? { firstName: prev.first_name, lastName: prev.last_name } : undefined,
      nextData: req.body,
      ip      : req.ip,
    });
    res.json(result);
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

export async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;
    const result = await adminService.deleteUser(id, req.user.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'DELETE',
      entity  : 'users',
      entityId: id,
      nextData: { deleted: true },
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
    const io     = req.app.get('io');
    const result = await adminService.forceLogout(req.params.id, io);
    await auditLog({
      userId  : req.user.id,
      action  : 'FORCE_LOGOUT',
      entity  : 'sessions',
      entityId: result.userId,  // use the user's UUID, not the token
      nextData: { sessionToken: req.params.id.slice(0, 8) + '…' },
      ip      : req.ip,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function flagAuditLog(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const result = await adminService.flagAuditLog(id, reason, req.user.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'FLAG',
      entity  : 'audit_logs',
      entityId: id,
      nextData: { reason },
      ip      : req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function unflagAuditLog(req, res, next) {
  try {
    const { id } = req.params;
    const result = await adminService.unflagAuditLog(id);
    await auditLog({
      userId  : req.user.id,
      action  : 'UNFLAG',
      entity  : 'audit_logs',
      entityId: id,
      ip      : req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getBlockedIps(req, res, next) {
  try {
    const list = await adminService.getBlockedIps();
    res.json(list);
  } catch (err) { next(err); }
}

export async function blockIp(req, res, next) {
  try {
    const { ipAddress, reason, expiresAt } = req.body;
    const result = await adminService.blockIp(ipAddress, reason, req.user.id, expiresAt);
    await auditLog({
      userId  : req.user.id,
      action  : 'BLOCK_IP',
      entity  : 'blocked_ips',
      entityId: result.id,
      nextData: { ipAddress, reason },
      ip      : req.ip,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function unblockIp(req, res, next) {
  try {
    const { id } = req.params;
    const result = await adminService.unblockIp(id, req.user.id);
    await auditLog({
      userId  : req.user.id,
      action  : 'UNBLOCK_IP',
      entity  : 'blocked_ips',
      entityId: id,
      nextData: { ipAddress: result.ip_address },
      ip      : req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}
