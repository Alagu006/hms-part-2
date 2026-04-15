import { emailQueue } from '../jobs/queue.js';
export { sendMail, transporter } from './mailer.js';

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------
function baseTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1a56db;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">
                ${process.env.HOSPITAL_NAME || 'Hospital Management System'}
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f4f6f9;padding:16px 32px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function tempPasswordTemplate(loginId, password, loginLabel = 'Employee ID') {
  return baseTemplate('Your Temporary Password', `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Welcome to ${process.env.HOSPITAL_NAME || 'HMS'}</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">
      Your account has been created. Use the credentials below to log in.
      You will be required to change your password on first login.
    </p>
    <div style="background:#f3f4f6;border-radius:6px;padding:16px 24px;margin:24px 0;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
        ${loginLabel}
      </p>
      <p style="margin:0 0 16px;color:#111827;font-size:24px;font-weight:bold;font-family:monospace;letter-spacing:2px;">
        ${loginId}
      </p>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
        Temporary Password
      </p>
      <p style="margin:0;color:#111827;font-size:24px;font-weight:bold;font-family:monospace;letter-spacing:2px;">
        ${password}
      </p>
    </div>
    <p style="margin:0;color:#ef4444;font-size:13px;">
      ⚠ Change your password immediately after first login. Do not share these credentials.
    </p>
  `);
}

export function otpTemplate(otp) {
  return baseTemplate('Your One-Time Password', `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Verification Code</h2>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">
      Use the code below to complete your request. It expires in <strong>10 minutes</strong>.
    </p>
    <div style="background:#f3f4f6;border-radius:6px;padding:16px 24px;margin:24px 0;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
        One-Time Password
      </p>
      <p style="margin:8px 0 0;color:#1a56db;font-size:40px;font-weight:bold;
                letter-spacing:8px;font-family:monospace;">
        ${otp}
      </p>
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px;">
      If you did not request this code, please ignore this email and contact IT support immediately.
    </p>
  `);
}

// ---------------------------------------------------------------------------
// Public API — enqueue, never block the request thread
// ---------------------------------------------------------------------------

/**
 * Queue a temporary password email.
 */
export async function sendTempPassword(to, loginId, password, loginLabel = 'Employee ID') {
  await emailQueue.add(
    'tempPassword',
    {
      to,
      subject: `Your account credentials — ${process.env.HOSPITAL_NAME || 'HMS'}`,
      html   : tempPasswordTemplate(loginId, password, loginLabel),
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } }
  );
}

/**
 * Queue an OTP email.
 */
export async function sendOTP(to, otp) {
  await emailQueue.add(
    'otp',
    {
      to,
      subject: `Your verification code — ${process.env.HOSPITAL_NAME || 'HMS'}`,
      html   : otpTemplate(otp),
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 3_000 } }
  );
}

/**
 * Queue a generic notification email.
 *
 * @param {string} to
 * @param {string} subject
 * @param {string} html  — full HTML string (use baseTemplate() for consistency)
 */
export async function sendNotification(to, subject, html) {
  await emailQueue.add(
    'notification',
    { to, subject, html },
    { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } }
  );
}
