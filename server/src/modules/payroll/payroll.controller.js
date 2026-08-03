import {
  upsertSalaryStructure,
  getSalaryStructure,
  getSalaryHistory,
  createPayrollRun,
  listPayrollRuns,
  processPayrollRun,
  getRunDetails,
  getUserPayslips,
} from './payroll.service.js';

// ---------------------------------------------------------------------------
// Salary structures
// ---------------------------------------------------------------------------

export async function handleUpsertSalaryStructure(req, res, next) {
  try {
    const result = await upsertSalaryStructure(req.params.userId, req.body, req.user.id);
    res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function handleGetSalaryStructure(req, res, next) {
  try {
    const result = await getSalaryStructure(req.params.userId);
    if (!result) return res.status(404).json({ error: 'No salary structure found' });
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function handleGetSalaryHistory(req, res, next) {
  try {
    const result = await getSalaryHistory(req.params.userId);
    res.json({ data: result });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

export async function handleCreateRun(req, res, next) {
  try {
    const run = await createPayrollRun(req.body, req.user.id);
    res.status(201).json({ data: run });
  } catch (err) { next(err); }
}

export async function handleListRuns(req, res, next) {
  try {
    const { year, month, page, limit } = req.query;
    const result = await listPayrollRuns({
      year : year  ? parseInt(year, 10)  : undefined,
      month: month ? parseInt(month, 10) : undefined,
      page : page  ? parseInt(page, 10)  : 1,
      limit: limit ? parseInt(limit, 10) : 24,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function handleProcessRun(req, res, next) {
  try {
    const run = await processPayrollRun(req.params.runId, req.user.id);
    res.json({ data: run });
  } catch (err) { next(err); }
}

export async function handleGetRunDetails(req, res, next) {
  try {
    const { hasError, search, page, limit } = req.query;
    const result = await getRunDetails(req.params.runId, {
      hasError,
      search,
      page : page  ? parseInt(page, 10)  : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function handleGetMyPayslips(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await getUserPayslips(req.user.id, {
      page : page  ? parseInt(page, 10)  : 1,
      limit: limit ? parseInt(limit, 10) : 24,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function handleGetUserPayslips(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await getUserPayslips(req.params.userId, {
      page : page  ? parseInt(page, 10)  : 1,
      limit: limit ? parseInt(limit, 10) : 24,
    });
    res.json(result);
  } catch (err) { next(err); }
}
