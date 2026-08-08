/**
 * PDF generation using Puppeteer.
 * Single function: generatePdf(htmlString) → Promise<Buffer>
 *
 * SYSTEM DEPENDENCIES (minimal / Docker environments)
 * ---------------------------------------------------
 * Puppeteer downloads its own Chromium at `npm install` time, but Chromium
 * still needs shared system libraries. On Debian/Ubuntu install:
 *
 *   apt-get update && apt-get install -y \
 *     libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
 *     libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
 *     libgbm1 libgtk-3-0 libasound2 libpangocairo-1.0-0 libpango-1.0-0
 *
 * Alternative: deploy with `puppeteer-core` and point CHROME_PATH at a pinned
 * system Chrome/Chromium binary (no bundled Chromium download needed):
 *
 *   CHROME_PATH=/usr/bin/chromium-browser
 *
 * When Chrome cannot be launched (missing binary / shared libs), functions
 * throw a clear PdfUnavailableError instead of an unhandled rejection.
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let _browser = null;

/**
 * Launch (and cache) the headless browser.
 *
 * @returns {Promise<import('puppeteer').Browser>}
 * @throws {Error} PdfUnavailableError when Chrome fails to launch.
 */
async function getBrowser() {
  if (!_browser || !_browser.connected) {
    try {
      _browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      });
    } catch (err) {
      _browser = null;
      const error = new Error(
        `PDF generation is unavailable — Chrome failed to launch: ${err?.message ?? String(err)}`
      );
      error.name   = 'PdfUnavailableError';
      error.code   = 'PDF_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
  }
  return _browser;
}

/**
 * Escape a string for safe interpolation into HTML templates. PDFs render
 * user-supplied fields (names, notes, item descriptions), so every free-text
 * value must be escaped to prevent HTML/script injection (R19).
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate a PDF buffer from an HTML string.
 * Uses A4 paper with 10mm margins on all sides.
 *
 * @param {string} htmlString - Complete HTML document string
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generatePdf(htmlString) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // R19: harden against HTML injection / SSRF. The rendered HTML embeds
    // user-supplied fields. Disable script execution so injected <script> or
    // on* attribute handlers cannot run, and block every network request so
    // injected <img src>/<iframe>/<script src> cannot reach the internal
    // network or the cloud metadata service (no always-on network).
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') return req.continue();
      return req.abort('blockedbyclient');
    });

    // waitUntil: 'load' (not 'networkidle0', which can hang indefinitely when
    // Chromium keeps a background connection open).
    await page.setContent(htmlString, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({
      format              : 'A4',
      margin             : {
        top    : '10mm',
        right  : '10mm',
        bottom : '10mm',
        left   : '10mm',
      },
      printBackground    : true,
      displayHeaderFooter: false,
    });

    return Buffer.from(pdfBuffer);
  } catch (err) {
    // Launch failures already carry a clear, specific message — pass through.
    if (err?.code === 'PDF_UNAVAILABLE') throw err;

    const error = new Error(`PDF generation failed: ${err?.message ?? String(err)}`);
    error.name   = 'PdfGenerationError';
    error.code   = 'PDF_GENERATION_FAILED';
    error.status = 500;
    error.cause  = err;
    throw error;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* page already torn down */ }
    }
  }
}

/**
 * Generate a PDF and save it to a file path.
 * Creates parent directories if they don't exist.
 *
 * @param {string} htmlString
 * @param {string} filePath - Absolute path to save the PDF
 * @returns {Promise<string>} - The resolved file path
 */
export async function generatePdfToFile(htmlString, filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const buffer = await generatePdf(htmlString);
  const { writeFileSync } = await import('fs');
  writeFileSync(filePath, buffer);
  return filePath;
}
