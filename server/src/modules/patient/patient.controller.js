import * as patientService from './patient.service.js';

export async function createPatient(req, res, next) {
  try {
    const patient = await patientService.createPatient(
      req.body,
      req.user.id,
      req.ip,
      req.headers['user-agent']
    );
    return res.status(201).json({ data: patient });
  } catch (err) {
    next(err);
  }
}

export async function listPatients(req, res, next) {
  try {
    const filters = { ...req.query };
    if (filters.doctorId === 'me') {
      filters.doctorId = req.user.id;
    }
    const result = await patientService.listPatients(filters);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPatient(req, res, next) {
  try {
    const result = await patientService.getPatientById(req.params.id, req.user);
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    if (!result)                return res.status(404).json({ error: 'Patient not found' });
    return res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function updatePatient(req, res, next) {
  try {
    const result = await patientService.updatePatient(
      req.params.id,
      req.body,
      req.user.id,
      req.ip,
      req.headers['user-agent']
    );
    if (!result) return res.status(404).json({ error: 'Patient not found' });
    return res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getPatientTimeline(req, res, next) {
  try {
    const result = await patientService.getPatientTimeline(
      req.params.id,
      req.user,
      req.query
    );
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMyRecords(req, res, next) {
  try {
    const result = await patientService.getMyRecords(req.user.id);
    if (!result) return res.status(404).json({ error: 'No patient record found for this account' });
    return res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}
