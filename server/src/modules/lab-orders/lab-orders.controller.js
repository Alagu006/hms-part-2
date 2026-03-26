import * as svc from './lab-orders.service.js';

export async function listLabOrders(req, res, next) {
  try {
    const result = await svc.listLabOrders(req.query);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateLabOrder(req, res, next) {
  try {
    const order = await svc.updateLabOrder(req.params.id, req.body);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    return res.status(200).json({ data: order });
  } catch (err) {
    next(err);
  }
}

export async function createLabResult(req, res, next) {
  try {
    const result = await svc.createLabResult(req.body, req.user.id);
    return res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}
