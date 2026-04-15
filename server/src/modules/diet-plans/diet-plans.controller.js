import * as svc from './diet-plans.service.js';

export async function listDietPlans(req, res, next) {
  try {
    const rows = await svc.listDietPlans(req.parsedQuery ?? req.query);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createDietPlan(req, res, next) {
  try {
    const plan = await svc.createDietPlan(req.body, req.user.id);
    res.status(201).json(plan);
  } catch (err) { next(err); }
}

export async function updateDietPlan(req, res, next) {
  try {
    const plan = await svc.updateDietPlan(req.params.id, req.body);
    res.json(plan);
  } catch (err) { next(err); }
}
