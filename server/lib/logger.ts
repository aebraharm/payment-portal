// Structured JSON logs. Keys that could carry credentials or account data are redacted
// before anything reaches stdout, so logs are safe to ship to a log platform.

type Level = 'info' | 'warn' | 'error';

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|access_?code|iban|account|routing|swift|bic|sort_?code|transit|institution|card|cvv|mtcn|email|phone/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message.slice(0, 300) };
  }
  return { errorMessage: String(error).slice(0, 300) };
}
