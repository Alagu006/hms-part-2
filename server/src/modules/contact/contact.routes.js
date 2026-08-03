import { Router } from 'express';
import { z }      from 'zod';
import { sendMail } from '../../shared/services/mailer.js';
import { rateLimiter } from '../../shared/middleware/rateLimiter.js';

const router = Router();

// ── Zod schema ────────────────────────────────────────────────────────────────
const CRLF_PATTERN = /[\r\n]/;

const contactSchema = z.object({
  name   : z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  email  : z.string()
    .email('Invalid email address')
    .max(254, 'Email must be 254 characters or fewer')
    .refine((v) => !CRLF_PATTERN.test(v), { message: 'Email must not contain newline characters' }),
  subject: z.string().min(1, 'Subject is required').max(200, 'Subject must be 200 characters or fewer'),
  message: z.string().min(1, 'Message is required').max(2000, 'Message must be 2000 characters or fewer'),
});

// ── Dedicated rate limiter: 5 req / 15 min per IP ────────────────────────────
const contactRateLimiter = rateLimiter({
  windowSecs: 15 * 60,
  max       : 5,
  keyFn     : (req) => `contact:${req.ip}`,
});

// POST /api/contact
// Public — no authentication required.
router.post('/', contactRateLimiter, async (req, res, next) => {
  try {
    const result = contactSchema.safeParse(req.body ?? {});

    if (!result.success) {
      const errors = Object.fromEntries(
        result.error.errors.map((e) => [e.path[0] ?? 'unknown', e.message])
      );
      return res.status(422).json({ errors });
    }

    const { name, email, subject, message } = result.data;

    const hospitalName = process.env.HOSPITAL_NAME || 'City General Hospital';
    const contactEmail = process.env.HMS_CONTACT   || process.env.SMTP_FROM || process.env.SMTP_USER;

    // ── Email to hospital admin ───────────────────────────────────────────────
    await sendMail({
      to     : contactEmail,
      subject: `[Contact Form] ${subject.trim()}`,
      html   : `
        <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px;">
          <div style="background:#1d4ed8;padding:20px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;font-size:18px;">🏥 ${hospitalName} — New Contact Form Submission</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:8px 0;color:#6b7280;width:100px;vertical-align:top;font-weight:600;">Name</td>
                <td style="padding:8px 0;color:#111827;">${escapeHtml(name.trim())}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b7280;vertical-align:top;font-weight:600;">Email</td>
                <td style="padding:8px 0;color:#111827;">
                  <a href="mailto:${escapeHtml(email.trim())}" style="color:#1d4ed8;">${escapeHtml(email.trim())}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b7280;vertical-align:top;font-weight:600;">Subject</td>
                <td style="padding:8px 0;color:#111827;">${escapeHtml(subject.trim())}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b7280;vertical-align:top;font-weight:600;">Message</td>
                <td style="padding:8px 0;color:#111827;white-space:pre-wrap;">${escapeHtml(message.trim())}</td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <p style="font-size:12px;color:#9ca3af;margin:0;">
              Sent via the ${hospitalName} website contact form on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.
            </p>
          </div>
        </div>
      `,
    });

    // ── Auto-reply to the sender ──────────────────────────────────────────────
    await sendMail({
      to     : email.trim(),
      subject: `We received your message — ${hospitalName}`,
      html   : `
        <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px;">
          <div style="background:#1d4ed8;padding:20px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;font-size:18px;">🏥 ${hospitalName}</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;color:#111827;margin:0 0 12px;">Hi ${escapeHtml(name.trim())},</p>
            <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px;">
              Thank you for reaching out to us. We have received your message and our team will get back to you within <strong>1–2 business days</strong>.
            </p>
            <div style="background:#f3f4f6;border-left:4px solid #1d4ed8;padding:12px 16px;border-radius:4px;margin:16px 0;">
              <p style="font-size:13px;color:#6b7280;margin:0 0 4px;font-weight:600;">Your message:</p>
              <p style="font-size:13px;color:#374151;margin:0;white-space:pre-wrap;">${escapeHtml(message.trim())}</p>
            </div>
            <p style="font-size:14px;color:#374151;line-height:1.6;margin:12px 0 0;">
              For urgent medical matters, please call us at <strong>+91 12345 67890</strong> or visit the hospital directly.
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <p style="font-size:12px;color:#9ca3af;margin:0;">${hospitalName} · 123 Medical Avenue, City — 400001</p>
          </div>
        </div>
      `,
    });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Minimal HTML escaping to prevent XSS in email bodies
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;
