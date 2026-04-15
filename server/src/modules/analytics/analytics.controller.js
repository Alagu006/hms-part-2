import * as svc    from './analytics.service.js';
import * as reports from './report.service.js';
import { redis } from '../../shared/services/redis.service.js';
import { createReadStream, existsSync } from 'fs';

export async function patientStats(req, res, next) {
  try {
    const data = await svc.getPatientStats((req.parsedQuery ?? req.query).period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function financialStats(req, res, next) {
  try {
    const data = await svc.getFinancialStats((req.parsedQuery ?? req.query).period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function staffPerformance(req, res, next) {
  try {
    const data = await svc.getStaffPerformance((req.parsedQuery ?? req.query).period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function operationalStats(req, res, next) {
  try {
    const data = await svc.getOperationalStats((req.parsedQuery ?? req.query).period ?? '30d');
    res.json(data);
  } catch (err) { next(err); }
}

export async function generateReport(req, res, next) {
  try {
    const result = await reports.enqueueReport(req.parsedQuery ?? req.query, req.user.id);
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
    const rows = await reports.getReportHistory(req.user.id, req.parsedQuery ?? req.query);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function downloadReport(req, res, next) {
  try {
    const filename = req.params.key;
    const redisKey = `report:file:${filename}`;
    const value    = await redis.get(redisKey);
    if (!value) return res.status(404).json({ error: 'File not found or expired' });

    const isPdf   = filename.endsWith('.pdf');
    const isJson  = filename.endsWith('.json');

    // PDF files are stored as absolute file paths on disk
    if (isPdf && existsSync(value)) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/pdf');
      const stream = createReadStream(value);
      stream.on('error', (err) => next(err));
      stream.pipe(res);
      return;
    }

    // CSV/JSON stored as base64
    const buf = Buffer.from(value, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', isJson ? 'application/json' : 'text/csv');
    res.send(buf);
  } catch (err) { next(err); }
}
