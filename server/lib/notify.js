import nodemailer from 'nodemailer';
import { run, get, isoNow } from '../db.js';
import { config, smtpConfigured } from '../config.js';

let transporter = null;

function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

function renderTemplate(template, vars) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    vars && vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : m
  );
}

/**
 * Persist a notification and attempt delivery. If SMTP is not configured the
 * notification is recorded as 'skipped_not_configured' — the app never
 * pretends an email was sent.
 */
export async function notify({ type, recipient, subject, body, vars, channel = 'email', adminEmail }) {
  const finalSubject = vars ? renderTemplate(subject, vars) : subject;
  const finalBody = vars ? renderTemplate(body, vars) : body;
  const target = recipient || adminEmail || config.notifyAdminEmail || null;

  const inserted = await run(
    `INSERT INTO notifications (type, recipient, subject, body, status, channel, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [type, target, finalSubject, finalBody, channel, isoNow()]
  );
  const id = inserted.lastInsertRowid;

  if (channel !== 'email') {
    await run("UPDATE notifications SET status = 'sent', sent_at = ? WHERE id = ?", [isoNow(), id]);
    return { id, status: 'sent' };
  }

  const transport = getTransporter();
  if (!transport || !target) {
    await run("UPDATE notifications SET status = 'skipped_not_configured' WHERE id = ?", [id]);
    console.log(
      `[notify] ${type} -> ${target || '(no recipient)'}: email not configured, notification stored only (id=${id})`
    );
    return { id, status: 'skipped_not_configured' };
  }

  try {
    await transport.sendMail({ from: config.smtp.from, to: target, subject: finalSubject, text: finalBody });
    await run("UPDATE notifications SET status = 'sent', sent_at = ? WHERE id = ?", [isoNow(), id]);
    return { id, status: 'sent' };
  } catch (err) {
    await run("UPDATE notifications SET status = 'failed', error = ? WHERE id = ?", [
      String(err.message || err).slice(0, 500),
      id,
    ]);
    console.error(`[notify] ${type} delivery failed:`, err.message);
    return { id, status: 'failed', error: err.message };
  }
}

export async function getNotificationTemplates() {
  const row = await get('SELECT value FROM settings WHERE key = ?', ['notification_templates']);
  if (!row) return {};
  try {
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

/** Convenience helper: notify using an editable template from settings. */
export async function notifyFromTemplate(type, { recipient, vars, fallbackSubject, fallbackBody }) {
  const templates = await getNotificationTemplates();
  const tpl = templates[type] || {};
  return await notify({
    type,
    recipient,
    subject: tpl.subject || fallbackSubject,
    body: tpl.body || fallbackBody,
    vars,
  });
}
