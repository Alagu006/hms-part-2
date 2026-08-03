/**
 * Nodemailer transporter singleton.
 * Kept separate to avoid circular imports between email.service.js and queue.js.
 */
import nodemailer from 'nodemailer';
import { logger } from '../logger.js';

export const transporter = nodemailer.createTransport({
  host  : process.env.SMTP_HOST   || 'smtp.gmail.com',
  port  : parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE !== 'false',
  auth  : {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool          : true,
  maxConnections: 5,
  maxMessages   : 100,
});

transporter.verify((err) => {
  if (err) logger.error('[mailer] SMTP connection failed:', { message: err.message });
  else     logger.info('[mailer] SMTP ready');
});

export const FROM = `"${process.env.HOSPITAL_NAME || 'HMS'}" <${process.env.SMTP_FROM || process.env.SMTP_USER || 'hms@hospital.local'}>`;

export async function sendMail({ to, subject, html }) {
  return transporter.sendMail({ from: FROM, to, subject, html });
}
