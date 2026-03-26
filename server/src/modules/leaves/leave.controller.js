import * as leaveService from './leave.service.js';

export async function applyLeave(req, res, next) {
  try {
    const leave = await leaveService.applyLeave(
      { userId: req.user.id, ...req.body },
      req.ip
    );
    res.status(201).json(leave);
  } catch (err) { next(err); }
}

export async function getMyLeaves(req, res, next) {
  try {
    const data = await leaveService.getMyLeaves(req.user.id);
    res.json(data);
  } catch (err) { next(err); }
}

export async function getAllLeaves(req, res, next) {
  try {
    const leaves = await leaveService.getAllLeaves(req.query);
    res.json(leaves);
  } catch (err) { next(err); }
}

export async function approveLeave(req, res, next) {
  try {
    const leave = await leaveService.approveLeave(req.params.id, req.user.id, req.ip);
    res.json(leave);
  } catch (err) { next(err); }
}

export async function rejectLeave(req, res, next) {
  try {
    const leave = await leaveService.rejectLeave(
      req.params.id, req.user.id, req.body.reviewNote, req.ip
    );
    res.json(leave);
  } catch (err) { next(err); }
}

export async function getBalances(req, res, next) {
  try {
    // Users can only see their own balances unless HR/ADMIN
    const targetId = req.params.userId;
    const isOwn    = targetId === req.user.id;
    const isAdmin  = req.user.roles?.some((r) => ['ADMIN','SUPER_ADMIN','HR'].includes(r));
    if (!isOwn && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const balances = await leaveService.getBalances(targetId);
    res.json(balances);
  } catch (err) { next(err); }
}

export async function getLeaveCalendar(req, res, next) {
  try {
    const rows = await leaveService.getLeaveCalendar(req.query);
    res.json(rows);
  } catch (err) { next(err); }
}
