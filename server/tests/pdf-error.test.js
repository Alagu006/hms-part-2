import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PDF generation so we can force the Chrome-unavailable path without
// launching a real browser. These factories are matched by resolved module
// path, so the modules under test get the mocked versions.
vi.mock('../src/shared/utils/pdf.service.js', () => ({
  generatePdf: vi.fn(),
  generatePdfToFile: vi.fn(),
  escapeHtml: (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
}));

vi.mock('../src/modules/billing/billing.service.js', () => ({
  getBillById: vi.fn(),
}));

vi.mock('../src/modules/prescription/prescription.service.js', () => ({
  getPrescriptionById: vi.fn(),
}));

vi.mock('../src/modules/analytics/analytics.service.js', () => ({
  getPatientStats  : vi.fn(),
  getFinancialStats : vi.fn(),
  getStaffPerformance: vi.fn(),
}));

// Keep the test isolated from DB/Redis/queue infrastructure.
vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgDecrypt: vi.fn((value) => Promise.resolve(value)),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  pool : {},
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: { setex: vi.fn() },
}));

vi.mock('../src/shared/jobs/queue.js', () => ({
  reportQueue: { add: vi.fn() },
}));

import { generatePdf, generatePdfToFile } from '../src/shared/utils/pdf.service.js';
import { downloadBillPdf } from '../src/modules/billing/billing.controller.js';
import { downloadPrescriptionPdf } from '../src/modules/prescription/prescription.controller.js';
import * as reports from '../src/modules/analytics/report.service.js';
import { getBillById } from '../src/modules/billing/billing.service.js';
import { getPrescriptionById } from '../src/modules/prescription/prescription.service.js';
import { getPatientStats } from '../src/modules/analytics/analytics.service.js';

function pdfUnavailable() {
  const err = new Error('PDF generation is unavailable — Chrome failed to launch: boom');
  err.name   = 'PdfUnavailableError';
  err.code   = 'PDF_UNAVAILABLE';
  err.status = 503;
  return err;
}

function pdfFailed() {
  const err = new Error('PDF generation failed: something broke');
  err.name   = 'PdfGenerationError';
  err.code   = 'PDF_GENERATION_FAILED';
  err.status = 500;
  return err;
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status    = (code) => { res.statusCode = code; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.json      = (body) => { res.body = body; return res; };
  res.send      = (body) => { res.body = body; return res; };
  return res;
}

describe('PDF error handling (callers)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('billing downloadBillPdf → 503 JSON when Chrome cannot launch', async () => {
    getBillById.mockResolvedValue({
      id: 'b1', bill_number: 'B-1', items: [], payments: [],
      issued_at: new Date().toISOString(),
      tax_amount: 0, net_amount: 0, patient_name: 'A', mrn: 'M',
    });
    generatePdf.mockRejectedValue(pdfUnavailable());

    const res  = mockRes();
    const next = vi.fn();
    await downloadBillPdf({ params: { id: 'b1' } }, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/PDF generation is unavailable — Chrome failed to launch/);
    expect(next).not.toHaveBeenCalled();
  });

  it('billing downloadBillPdf → 500 JSON on generic PDF failure', async () => {
    getBillById.mockResolvedValue({
      id: 'b1', bill_number: 'B-1', items: [], payments: [],
      issued_at: new Date().toISOString(),
      tax_amount: 0, net_amount: 0, patient_name: 'A', mrn: 'M',
    });
    generatePdf.mockRejectedValue(pdfFailed());

    const res  = mockRes();
    const next = vi.fn();
    await downloadBillPdf({ params: { id: 'b1' } }, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('PDF generation failed: something broke');
    expect(next).not.toHaveBeenCalled();
  });

  it('billing: non-PDF errors still flow to next(err)', async () => {
    getBillById.mockRejectedValue(new Error('db down'));

    const res  = mockRes();
    const next = vi.fn();
    await downloadBillPdf({ params: { id: 'b1' } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toBe('db down');
  });

  it('prescription downloadPrescriptionPdf → 503 JSON when Chrome cannot launch', async () => {
    getPrescriptionById.mockResolvedValue({
      id: 'p1', items: [], created_at: new Date().toISOString(),
      patient_first: 'A', patient_last: 'B',
      doctor_first: 'C', doctor_last: 'D', notes: {},
    });
    generatePdf.mockRejectedValue(pdfUnavailable());

    const res  = mockRes();
    const next = vi.fn();
    await downloadPrescriptionPdf(
      { params: { id: 'p1' }, user: { id: 'u1', roles: ['ADMIN'] } },
      res, next
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/PDF generation is unavailable — Chrome failed to launch/);
    expect(next).not.toHaveBeenCalled();
  });

  it('report.service rethrows generic PDF failure as PDF_GENERATION_FAILED', async () => {
    getPatientStats.mockResolvedValue({ admissions: [], summary: {} });
    generatePdfToFile.mockRejectedValue(new Error('boom'));

    await expect(
      reports.generateReport({ type: 'patient', format: 'pdf', period: '30d', userId: 'u1' })
    ).rejects.toMatchObject({ code: 'PDF_GENERATION_FAILED', status: 500 });
  });

  it('report.service passes PDF_UNAVAILABLE through unchanged', async () => {
    getPatientStats.mockResolvedValue({ admissions: [], summary: {} });
    generatePdfToFile.mockRejectedValue(pdfUnavailable());

    await expect(
      reports.generateReport({ type: 'patient', format: 'pdf', period: '30d', userId: 'u1' })
    ).rejects.toMatchObject({ code: 'PDF_UNAVAILABLE', status: 503 });
  });

  it('escapes user-supplied fields in the bill PDF HTML (R19)', async () => {
    getBillById.mockResolvedValue({
      id: 'b1', bill_number: 'B-1',
      items: [{ description: '<script>alert(1)</script>', quantity: 1, unit_price: 10, total_price: 10 }],
      payments: [{ method: 'CARD', amount: 10, processed_at: new Date().toISOString() }],
      issued_at: new Date().toISOString(),
      tax_amount: 0, net_amount: 10, patient_name: 'Rob <b>Hood</b>', mrn: 'M-1',
    });
    generatePdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));

    const res  = mockRes();
    const next = vi.fn();
    await downloadBillPdf({ params: { id: 'b1' } }, res, next);

    const html = generatePdf.mock.calls[0][0];
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Rob &lt;b&gt;Hood&lt;/b&gt;');
    expect(res.statusCode).toBe(200);
  });

  it('escapes user-supplied fields in the prescription PDF HTML (R19)', async () => {
    getPrescriptionById.mockResolvedValue({
      id: 'p1',
      items: [{
        medicine_name: 'Dolo <b>650</b>', dosage: '1', frequency: 'BD',
        duration_days: 5, instructions: '<img src=x> instructions',
      }],
      created_at: new Date().toISOString(),
      patient_first: 'A<script>', patient_last: 'B',
      doctor_first: 'C', doctor_last: 'D',
      notes: { freeNotes: '<script>evil()</script>', diagnosisCodes: ['J00'] },
    });
    generatePdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));

    const res  = mockRes();
    const next = vi.fn();
    await downloadPrescriptionPdf(
      { params: { id: 'p1' }, user: { id: 'u1', roles: ['ADMIN'] } }, res, next
    );

    const html = generatePdf.mock.calls[0][0];
    expect(html).toContain('A&lt;script&gt;');
    expect(html).not.toContain('A<script>');
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x&gt; instructions');
    expect(html).toContain('Dolo &lt;b&gt;650&lt;/b&gt;');
    expect(res.statusCode).toBe(200);
  });
});
