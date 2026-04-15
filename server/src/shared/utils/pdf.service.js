/**
 * PDF generation using Puppeteer.
 * Single function: generatePdf(htmlString) → Promise<Buffer>
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let _browser = null;

async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return _browser;
}

/**
 * Generate a PDF buffer from an HTML string.
 * Uses A4 paper with 10mm margins on all sides.
 *
 * @param {string} htmlString - Complete HTML document string
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generatePdf(htmlString) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(htmlString, { waitUntil: 'networkidle0' });

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
  } finally {
    await page.close();
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
