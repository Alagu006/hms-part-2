import * as shiftService from './shifts.service.js';

export async function listShifts(req, res, next) {
  try {
    const result = await shiftService.listShifts(req.query);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function createShift(req, res, next) {
  try {
    const shift = await shiftService.createShift(req.body, req.user.id);
    if (!shift) {
      return res.status(409).json({ error: 'Shift already exists for this user, date, and type' });
    }
    return res.status(201).json({ data: shift });
  } catch (err) {
    next(err);
  }
}

export async function deleteShift(req, res, next) {
  try {
    const shift = await shiftService.deleteShift(req.params.id);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    return res.status(200).json({ data: shift });
  } catch (err) {
    next(err);
  }
}
