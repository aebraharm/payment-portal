// Email delivery. When SMTP is not configured the mailer reports `configured: false` and the
// notification is recorded as "not configured". Nothing is ever reported as sent without a real send.

import nodemailer from 'nodemailer';
import type { SmtpConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

export function createSmtpMailer(config: SmtpConfig | null): Mailer {
  if (!config) {
    return {
      configured: false,
      async send() {
        throw new Error('Email delivery is not configured.');
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    configured: true,
    async send(message) {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject.replace(/[\r\n]+/g, ' '),
        text: message.text,
      });
    },
  };
}

/** In-memory mailer for tests and previews. Records messages instead of sending them. */
export function createMemoryMailer(options: { configured?: boolean; failWith?: string } = {}): Mailer & {
  sent: MailMessage[];
  setFailure(message: string | null): void;
} {
  const sent: MailMessage[] = [];
  let failure = options.failWith ?? null;
  return {
    configured: options.configured ?? true,
    sent,
    setFailure(message) {
      failure = message;
    },
    async send(message) {
      if (!this.configured) throw new Error('Email delivery is not configured.');
      if (failure) throw new Error(failure);
      sent.push(message);
    },
  };
}
