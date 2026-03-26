import * as svc    from './analytics.service.js';
import * as reports from './report.service.js';
import { redis }    from '../../shared/db/redis.js';

export async function patientStats(req, res, next) {
  try {
    const data = await svc.getPatientStats(req.query.period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function financialStats(req, res, next) {
  try {
    const data = await svc.getFinancialStats(req.query.period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function staffPerformance(req, res, next) {
  try {
    const data = await svc.getStaffPerformance(req.query.period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function operationalStats(req, res, next) {
  try {
    const data = await svc.getOperationalStats(req.query.period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function generateReport(req, res, next) {
  try {
    const result = await reports.enqueueReport(req.query, req.user.id);
    res.status(202).json(result);
  } catch (err) { next(err); }
}

export async function reportStatus(req, res, next) {
  try {
    const status = await reports.getReportStatus(req.params.jobId);
    if (!status) return res.status(404).json({ error: 'Job not found' });
    res.json(status);
  } catch (err) { next(err); }
}

export async function reportHistory(req, res, next) {
  try {
    const rows = await reports.getReportHistory(req.user.id, req.query);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function downloadReport(req, res, next) {
  try {
    // key param is already validated by downloadKeySchema (safe filename only)
    // Prefix with namespace to scope Redis reads — no user-controlled prefix
    const filename    = req.params.key;
    const redisKey    = `report:file:${filename}`;
    const encoded     = await redis.get(redisKey);
    if (!encoded) return res.status(404).json({ error: 'File not found or expired' });

    const buf    = Buffer.from(encoded, 'base64');
    const isJson = filename.endsWith('.json');

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', isJson ? 'application/json' : 'text/csv');
    res.send(buf);
  } catch (err) { next(err); }
}
