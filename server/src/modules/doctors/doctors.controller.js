import * as doctorService from './doctors.service.js';

export async function listDoctors(req, res, next) {
  try {
    const result = await doctorService.listDoctors((req.parsedQuery ?? req.query));
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
