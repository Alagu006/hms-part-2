// Direct tests for pdf.service.js R19 hardening — JS disabled + network
// blocked when rendering user-supplied HTML into a PDF (prevents SSRF and
// HTML/script injection), plus the escapeHtml helper used by the PDF callers.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = vi.hoisted(() => ({ page: null, requestListener: null }));

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(async () => {
      const page = {
        setJavaScriptEnabled: vi.fn(async () => {}),
        setRequestInterception: vi.fn(async () => {}),
        on: (event, cb) => {
          if (event === 'request') handlers.requestListener = cb;
        },
        setContent: vi.fn(async () => {}),
        pdf: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
        close: vi.fn(async () => {}),
      };
      handlers.page = page;
      return { connected: true, newPage: vi.fn(async () => page) };
    }),
  },
}));

import { generatePdf, escapeHtml } from '../src/shared/utils/pdf.service.js';

describe('pdf.service — R19 hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.requestListener = null;
  });

  it('disables JavaScript and request interception before rendering', async () => {
    const buffer = await generatePdf('<!DOCTYPE html><html><body>ok</body></html>');
    expect(Buffer.isBuffer(buffer)).toBe(true);

    expect(handlers.page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(handlers.page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(typeof handlers.requestListener).toBe('function');
  });

  it('aborts every network request (SSRF) but allows inline data:', async () => {
    await generatePdf('<html></html>');

    const request = (url) => ({
      url: () => url,
      abort: vi.fn(),
      continue: vi.fn(),
    });

    const evil = request('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    handlers.requestListener(evil);
    expect(evil.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(evil.continue).not.toHaveBeenCalled();

    const remote = request('https://example.com/logo.png');
    handlers.requestListener(remote);
    expect(remote.abort).toHaveBeenCalledTimes(1);

    const inline = request('data:image/png;base64,iVBORw0KGgo=');
    handlers.requestListener(inline);
    expect(inline.continue).toHaveBeenCalledTimes(1);
    expect(inline.abort).not.toHaveBeenCalled();
  });
});

describe('pdf.service — escapeHtml (R19)', () => {
  it('neutralizes HTML/script metacharacters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(escapeHtml("O'Neil & Sons")).toBe('O&#39;Neil &amp; Sons');
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('handles null/undefined safely', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});
