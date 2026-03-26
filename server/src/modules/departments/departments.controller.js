import * as deptService from './departments.service.js';

export async function listDepartments(req, res, next) {
  try {
    const result = await deptService.listDepartments(req.query);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function createDepartment(req, res, next) {
  try {
    const dept = await deptService.createDepartment(req.body, req.user.id);
    return res.status(201).json({ data: dept });
  } catch (err) {
    next(err);
  }
}

export async function updateDepartment(req, res, next) {
  try {
    const dept = await deptService.updateDepartment(req.params.id, req.body);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    return res.status(200).json({ data: dept });
  } catch (err) {
    next(err);
  }
}
