import * as visitorService from './visitors.service.js';

export async function logVisitor(req, res, next) {
  try {
    const visitor = await visitorService.logVisitor(
      req.body,
      req.user.id,
      req.ip,
      req.headers['user-agent']
    );
    return res.status(201).json({ data: visitor });
  } catch (err) {
    next(err);
  }
}

export async function getVisitorHistory(req, res, next) {
  try {
    const result = await visitorService.getVisitorHistory(req.params.patientId, (req.parsedQuery ?? req.query));
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listAllVisitors(req, res, next) {
  try {
    const result = await visitorService.listAllVisitors((req.parsedQuery ?? req.query));
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function checkoutVisitor(req, res, next) {
  try {
    const visitor = await visitorService.checkoutVisitor(req.params.id, req.user.id);
    if (!visitor) return res.status(404).json({ error: 'Visitor not found or already checked out' });
    return res.status(200).json({ data: visitor });
  } catch (err) {
    next(err);
  }
}

export async function searchVisitors(req, res, next) {
  try {
    const results = await visitorService.searchPastVisitors(req.query.q);
    return res.status(200).json({ data: results });
  } catch (err) {
    next(err);
  }
}
