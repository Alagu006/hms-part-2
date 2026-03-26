import * as apptService from './appointments.service.js';
import { query } from '../../shared/db/pool.js';

export async function listAppointments(req, res, next) {
  try {
    const filters = { ...req.query };
    if (req.query.doctorId === 'me') {
      filters.doctorId = req.user.id;
    }
    if (req.query.patientId === 'me') {
      const { rows } = await query(
        `SELECT id FROM patients WHERE user_id = $1 AND deleted_at IS NULL`,
        [req.user.id]
      );
      if (!rows[0]) {
        return res.status(403).json({ error: 'No patient record found' });
      }
      filters.patientId = rows[0].id;
    }
    const result = await apptService.listAppointments(filters);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getAppointment(req, res, next) {
  try {
    const appt = await apptService.getAppointmentById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    return res.status(200).json({ data: appt });
  } catch (err) {
    next(err);
  }
}

export async function updateAppointmentStatus(req, res, next) {
  try {
    const appt = await apptService.updateAppointmentStatus(
      req.params.id,
      req.body,
      req.body.status === 'CANCELLED' ? req.user.id : null
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    return res.status(200).json({ data: appt });
  } catch (err) {
    next(err);
  }
}

export async function createAppointment(req, res, next) {
  try {
    const isPatient = req.user.roles?.includes('PATIENT');
    let patientId = req.body.patientId;

    if (isPatient) {
      const { rows } = await query(
        `SELECT id FROM patients WHERE user_id = $1 AND deleted_at IS NULL`,
        [req.user.id]
      );
      if (!rows[0]) {
        return res.status(403).json({ error: 'No patient record found for your account' });
      }
      if (rows[0].id !== req.body.patientId) {
        return res.status(403).json({ error: 'You can only book appointments for yourself' });
      }
      patientId = rows[0].id;
    }

    const appt = await apptService.createAppointment(
      { ...req.body, patientId },
      req.user.id
    );
    return res.status(201).json({ data: appt });
  } catch (err) {
    next(err);
  }
}
