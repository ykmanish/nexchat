import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let transporter = null;
let usingEthereal = false;

/** A host with a username but no password can never authenticate — treat that
 *  as "not configured yet" rather than failing every signup. */
const smtpReady = () =>
  !!env.mail.host && (!env.mail.user || !!env.mail.pass);

async function useEthereal() {
  try {
    const acct = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: acct.smtp.host,
      port: acct.smtp.port,
      secure: acct.smtp.secure,
      auth: { user: acct.user, pass: acct.pass },
    });
    usingEthereal = true;
    logger.warn('Mailer → Ethereal test inbox. Codes are printed below and previewable.');
  } catch {
    transporter = { sendMail: async () => ({ messageId: 'console-only' }) };
    logger.warn('Mailer → console only (offline). Codes are printed below.');
  }
  return transporter;
}

async function getTransport() {
  if (transporter) return transporter;

  if (!smtpReady()) {
    if (env.mail.host && env.mail.user && !env.mail.pass) {
      logger.warn(
        'SMTP_PASS is empty for ' + env.mail.user + ' — add a Google App Password to .env to send real mail.'
      );
    }
    return useEthereal();
  }

  const candidate = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
  });

  // Fail loudly once at startup rather than silently on every signup.
  try {
    await candidate.verify();
    transporter = candidate;
    logger.success('Mailer → ' + env.mail.host + ':' + env.mail.port + ' as ' + env.mail.user);
  } catch (err) {
    logger.error('SMTP login failed for ' + env.mail.user + ': ' + err.message);
    if (/Username and Password not accepted|BadCredentials/i.test(err.message)) {
      logger.error(
        'Gmail needs a 16-character App Password (2-Step Verification must be on), not your account password.'
      );
    }
    logger.warn('Falling back to a test inbox so signup keeps working.');
    return useEthereal();
  }

  return transporter;
}

const shell = (title, intro, inner) => `
<!doctype html><html><body style="margin:0;padding:0;background:#F2F4F5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#F2F4F5;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#FFFFFF;border-radius:24px;overflow:hidden;
                    box-shadow:0 12px 40px rgba(0,0,0,.06);">
        <tr><td style="padding:40px 40px 8px;text-align:center;">
          <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:18px;
                      background:linear-gradient(140deg,#3EDC81 0%,#21C063 100%);
                      font-size:26px;font-weight:700;color:#ffffff;">N</div>
          <h1 style="margin:24px 0 4px;font-size:24px;letter-spacing:-.5px;color:#111B21;">${title}</h1>
          <p style="margin:0;font-size:15px;line-height:1.55;color:#667781;">${intro}</p>
        </td></tr>
        <tr><td style="padding:28px 40px 40px;">${inner}</td></tr>
        <tr><td style="padding:20px 40px 32px;border-top:1px solid #E9EDEF;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8696A0;text-align:center;">
            Your messages are end-to-end encrypted — not even ${env.appName} can read them.<br/>
            If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:11px;color:#8696A0;">© ${new Date().getFullYear()} ${env.appName}</p>
    </td></tr>
  </table>
</body></html>`;

const codeBlock = (code) => `
  <div style="text-align:center;">
    <div style="display:inline-block;padding:18px 28px;border-radius:18px;background:#F2F4F5;">
      <span style="font-size:34px;letter-spacing:10px;font-weight:600;color:#111B21;
                   font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${code}</span>
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:#667781;">This code expires in 10 minutes.</p>
  </div>`;

async function deliver({ to, subject, html, text }) {
  const t = await getTransport();
  const info = await t.sendMail({ from: env.mail.from, to, subject, html, text });
  if (usingEthereal) {
    const url = nodemailer.getTestMessageUrl(info);
    if (url) logger.info(`Email preview → ${url}`);
  }
  return info;
}

export const mailer = {
  async sendVerificationCode(to, code, name = 'there') {
    logger.info(`Verification code for ${to} → ${code}`);
    return deliver({
      to,
      subject: `${code} is your ${env.appName} verification code`,
      text: `Hi ${name}, your ${env.appName} code is ${code}. It expires in 10 minutes.`,
      html: shell(
        'Verify your email',
        `Hi ${name} — enter this code in ${env.appName} to finish setting up your account.`,
        codeBlock(code)
      ),
    });
  },

  async sendLoginCode(to, code) {
    logger.info(`Login code for ${to} → ${code}`);
    return deliver({
      to,
      subject: `${code} is your ${env.appName} sign-in code`,
      text: `Your ${env.appName} sign-in code is ${code}.`,
      html: shell('Sign in to ' + env.appName, 'Use this code to continue signing in.', codeBlock(code)),
    });
  },

  async sendPasswordReset(to, code) {
    logger.info(`Password reset code for ${to} → ${code}`);
    return deliver({
      to,
      subject: `${code} is your ${env.appName} password reset code`,
      text: `Your ${env.appName} password reset code is ${code}.`,
      html: shell(
        'Reset your password',
        'Enter this code to choose a new password.',
        codeBlock(code) +
          `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#667781;text-align:center;">
             Resetting your password re-encrypts your keys. You may need to re-link other devices.
           </p>`
      ),
    });
  },

  async sendNewDeviceAlert(to, device) {
    return deliver({
      to,
      subject: `A new device was linked to your ${env.appName} account`,
      text: `${device.name} (${device.os || 'unknown OS'}) was linked to your account.`,
      html: shell(
        'New device linked',
        'A device just gained access to your account.',
        `<div style="padding:16px 18px;border-radius:16px;background:#F2F4F5;">
           <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#111B21;">${device.name}</p>
           <p style="margin:0;font-size:13px;color:#667781;">
             ${device.os || 'Unknown OS'} · ${device.browser || 'Unknown browser'}<br/>
             ${new Date().toLocaleString()}
           </p>
         </div>
         <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#667781;">
           Didn't do this? Open ${env.appName} → Settings → Linked devices and remove it right away.
         </p>`
      ),
    });
  },
};
