import * as svc from './nurse-assignments.service.js';

export async function getMyAssignments(req, res, next) {
  try {
    const date = req.query.date;
    const rows = await svc.getMyAssignmentsToday(req.user.id, date);
    return res.status(200).json({ assignments: rows });
  } catch (err) {
    next(err);
  }
}
