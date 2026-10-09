// Environment-driven configuration. Secrets are read from the environment only and are never
// returned by any API. Production refuses to start with unsafe or missing settings.

export interface S3Config {
  bucket: string;
  region: string;
  endpoint: string | null;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  appUrl: string;
  timeZone: string;
  databaseUrl: string | null;
  databaseSsl: boolean;
  dataDir: string;
  appSecret: string;
  cookieSecure: boolean;
  trustProxyHeaders: boolean;
  serverless: boolean;
  adminSessionHours: number;
  clientSessionHours: number;
  rateLimits: {
    windowMs: number;
    adminLoginPerEmail: number;
    adminLoginPerIp: number;
    clientLoginPerName: number;
    clientLoginPerIp: number;
    resetRequestsPerEmail: number;
  };
  receiptStorage: 'local' | 's3';
  receiptStorageDir: string;
  receiptMaxBytes: number;
  s3: S3Config | null;
  smtp: SmtpConfig | null;
  cronSecret: string | null;
  bootstrap: { email: string | null; password: string | null; name: string };
}

type Env = Record<string, string | undefined>;

const RECEIPT_LIMIT = 5 * 1024 * 1024;

function int(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number.`);
  return value;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'require'].includes(raw);
}

function text(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(env: Env = process.env): AppConfig {
  const nodeEnv = (text(env, 'NODE_ENV') ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test or production.');
  }
  const production = nodeEnv === 'production';
  const serverless = Boolean(env.NETLIFY || env.AWS_LAMBDA_FUNCTION_NAME);

  const appUrl = (text(env, 'APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, '');
  if (production && !appUrl.startsWith('https://')) {
    throw new Error('APP_URL must be an https:// address in production.');
  }

  const timeZone = text(env, 'APP_TIME_ZONE') ?? 'Africa/Lagos';
  if (!validTimeZone(timeZone)) throw new Error(`APP_TIME_ZONE is not a valid IANA timezone: ${timeZone}`);

  const databaseUrl = text(env, 'DATABASE_URL');
  if (production && !databaseUrl) {
    throw new Error('DATABASE_URL is required in production. Use a managed PostgreSQL database.');
  }
  if (serverless && !databaseUrl) {
    throw new Error('DATABASE_URL is required for serverless deployments. Local embedded databases do not persist.');
  }

  let appSecret = text(env, 'APP_SECRET') ?? '';
  if (appSecret.length < 32) {
    if (production || serverless) {
      throw new Error('APP_SECRET must be at least 32 random characters in production.');
    }
    // Development and tests get a per-process secret so nothing relies on a shared default.
    appSecret = `dev-only-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.padEnd(32, 'x');
  }

  const receiptStorage = (text(env, 'RECEIPT_STORAGE') ?? (serverless ? 's3' : 'local')) as AppConfig['receiptStorage'];
  if (receiptStorage !== 'local' && receiptStorage !== 's3') throw new Error('RECEIPT_STORAGE must be local or s3.');
  if (serverless && receiptStorage === 'local') {
    throw new Error('Serverless deployments must use RECEIPT_STORAGE=s3. Function filesystems are ephemeral.');
  }

  const dataDir = text(env, 'DATA_DIR') ?? '.data';
  const s3Bucket = text(env, 'S3_BUCKET');
  const s3: S3Config | null =
    receiptStorage === 's3'
      ? {
          bucket: s3Bucket ?? '',
          region: text(env, 'S3_REGION') ?? 'auto',
          endpoint: text(env, 'S3_ENDPOINT'),
          accessKeyId: text(env, 'S3_ACCESS_KEY_ID') ?? '',
          secretAccessKey: text(env, 'S3_SECRET_ACCESS_KEY') ?? '',
          forcePathStyle: bool(env, 'S3_FORCE_PATH_STYLE', false),
        }
      : null;
  if (s3 && (!s3.bucket || !s3.accessKeyId || !s3.secretAccessKey)) {
    throw new Error('S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when RECEIPT_STORAGE=s3.');
  }

  const smtpHost = text(env, 'SMTP_HOST');
  const smtp: SmtpConfig | null = smtpHost
    ? {
        host: smtpHost,
        port: int(env, 'SMTP_PORT', 587),
        secure: bool(env, 'SMTP_SECURE', false),
        user: text(env, 'SMTP_USER'),
        password: text(env, 'SMTP_PASSWORD'),
        from: text(env, 'SMTP_FROM') ?? 'payments@localhost.invalid',
      }
    : null;

  const receiptMaxBytes = Math.min(int(env, 'RECEIPT_MAX_BYTES', RECEIPT_LIMIT), RECEIPT_LIMIT);

  return {
    nodeEnv,
    appUrl,
    timeZone,
    databaseUrl,
    databaseSsl: bool(env, 'DATABASE_SSL', false),
    dataDir,
    appSecret,
    cookieSecure: bool(env, 'COOKIE_SECURE', appUrl.startsWith('https://')),
    trustProxyHeaders: bool(env, 'TRUST_PROXY_HEADERS', serverless),
    serverless,
    adminSessionHours: int(env, 'ADMIN_SESSION_HOURS', 8),
    clientSessionHours: int(env, 'CLIENT_SESSION_HOURS', 24),
    rateLimits: {
      windowMs: int(env, 'RATE_LIMIT_WINDOW_MINUTES', 15) * 60_000,
      adminLoginPerEmail: int(env, 'ADMIN_LOGIN_MAX_PER_EMAIL', 5),
      adminLoginPerIp: int(env, 'ADMIN_LOGIN_MAX_PER_IP', 30),
      clientLoginPerName: int(env, 'CLIENT_LOGIN_MAX_PER_NAME', 5),
      clientLoginPerIp: int(env, 'CLIENT_LOGIN_MAX_PER_IP', 30),
      resetRequestsPerEmail: int(env, 'RESET_REQUESTS_MAX_PER_EMAIL', 3),
    },
    receiptStorage,
    receiptStorageDir: text(env, 'RECEIPT_STORAGE_DIR') ?? `${dataDir}/receipts`,
    receiptMaxBytes,
    s3,
    smtp,
    cronSecret: text(env, 'CRON_SECRET'),
    bootstrap: {
      email: text(env, 'ADMIN_BOOTSTRAP_EMAIL')?.toLowerCase() ?? null,
      password: env.ADMIN_BOOTSTRAP_PASSWORD ?? null,
      name: text(env, 'ADMIN_BOOTSTRAP_NAME') ?? 'Administrator',
    },
  };
}
