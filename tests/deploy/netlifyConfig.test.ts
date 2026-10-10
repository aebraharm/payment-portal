import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

interface RedirectRule {
  from: string;
  to: string;
  status?: number;
  force?: boolean;
}
interface HeaderRule {
  for: string;
  values: Record<string, string>;
}
interface NetlifyConfig {
  build: Record<string, string>;
  buildEnvironment: Record<string, string>;
  functions: Record<string, string | string[]>;
  redirects: RedirectRule[];
  headers: HeaderRule[];
}

/**
 * A deliberately small TOML reader covering only the subset `netlify.toml`
 * uses: `[table]`, `[[array of tables]]`, `key = "string"`, `key = number`,
 * booleans and `#` comments. In-tree so the deploy config is verified without
 * adding a dependency to the app.
 */
function parseToml(source: string): NetlifyConfig {
  const out: NetlifyConfig = {
    build: {},
    buildEnvironment: {},
    functions: {},
    redirects: [],
    headers: [],
  };
  let current: Record<string, string | number | boolean> = out.build;

  const stripComment = (line: string) => {
    let inQuote = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '"') inQuote = !inQuote;
      else if (line[i] === '#' && !inQuote) return line.slice(0, i);
    }
    return line;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTable) {
      const name = arrayTable[1].trim();
      const entry: Record<string, string | number | boolean> = {};
      if (name === 'redirects') out.redirects.push(entry as unknown as RedirectRule);
      if (name === 'headers') out.headers.push(entry as unknown as HeaderRule);
      current = entry;
      continue;
    }

    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      const name = table[1].trim();
      if (name === 'build') current = out.build;
      else if (name === 'functions') current = out.functions as unknown as Record<string, string | number | boolean>;
      else if (name === 'build.environment') current = out.buildEnvironment;
      else if (name === 'headers.values') {
        const last = out.headers[out.headers.length - 1];
        if (last) {
          last.values = last.values || {};
          current = last.values;
        }
      } else current = {};
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (pair) {
      const literal = pair[2].trim();
      let value: string | number | boolean = literal;
      if (literal.startsWith('[')) {
        current[pair[1].trim()] = (JSON.parse(literal.replace(/'/g, '"')) as string[]);
        continue;
      }
      if (literal.startsWith('"')) value = JSON.parse(literal) as string;
      else if (/^-?\d+(\.\d+)?$/.test(literal)) value = Number(literal);
      else if (literal === 'true' || literal === 'false') value = literal === 'true';
      current[pair[1].trim()] = value;
    }
  }
  return out;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rawToml = fs.readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8');
const config = parseToml(rawToml);
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

describe('netlify.toml — SPA routing', () => {
  it('publishes the Vite build output', () => {
    expect(config.build.command).toBe('npm run build');
    expect(config.build.publish).toBe('dist');
    // The publish directory must track the real build output directory.
    const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
    expect(viteConfig.match(/outDir:\s*'([^']+)'/)?.[1]).toBe(config.build.publish);
  });

  it('rewrites unknown paths to index.html so client-side routes survive a refresh', () => {
    const fallback = config.redirects.find((r) => r.from === '/*');
    expect(fallback).toBeDefined();
    expect(fallback?.to).toBe('/index.html');
    // 200 = serve index.html under the original URL. A 301 would swap the URL
    // and lose the deep link, so /admin/login would land on the client portal.
    expect(fallback?.status).toBe(200);
  });

  it('keeps exactly one SPA fallback and no second source of redirect rules', () => {
    expect(config.redirects.filter((r) => r.from === '/*')).toHaveLength(1);
    // A public/_redirects file would override netlify.toml wholesale.
    expect(fs.existsSync(path.join(repoRoot, 'public/_redirects'))).toBe(false);
  });

  it('reserves the last rule for the catch-all so narrower rules win', () => {
    const fallbackIndex = config.redirects.findIndex((r) => r.from === '/*');
    expect(fallbackIndex).toBeGreaterThanOrEqual(0);
    // Any API rule placed after the catch-all never runs: Netlify takes the
    // first match, and /api/* would be answered with index.html instead of JSON.
    config.redirects.forEach((rule, index) => {
      if (rule.from === '/*') return;
      expect(index, `rule "${rule.from}" must precede the /* SPA fallback`).toBeLessThan(fallbackIndex);
    });
  });

  it('pins the Node runtime and mirrors the app security headers', () => {
    expect(Number(config.buildEnvironment.NODE_VERSION)).toBeGreaterThanOrEqual(22);
    const root = config.headers.find((h) => h.for === '/*');
    expect(root?.values['X-Content-Type-Options']).toBe('nosniff');
    expect(root?.values['Content-Security-Policy']).toContain("connect-src 'self'");
    expect(root?.values['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(config.headers.find((h) => h.for === '/assets/*')?.values['Cache-Control']).toContain('immutable');
  });
});

describe('netlify.toml — API function wiring', () => {
  const apiRedirect = config.redirects.find((r) => r.from === '/api/*');

  it('sends /api/* to the function instead of the SPA fallback', () => {
    expect(apiRedirect).toBeDefined();
    // 200 keeps the original URL and method; a redirect status would turn the
    // POST /api/admin/auth/login into a GET and silently break the app.
    expect(apiRedirect?.status).toBe(200);
    expect(apiRedirect?.force).not.toBe(false);
    const apiIndex = config.redirects.indexOf(apiRedirect as RedirectRule);
    const fallbackIndex = config.redirects.findIndex((r) => r.from === '/*');
    expect(apiIndex).toBeLessThan(fallbackIndex);
  });

  it('names the function the same in the redirect and on disk', () => {
    // `/.netlify/functions/api` is resolved by file name, so a mismatch here is
    // a 404 for every API call that no local test would catch.
    const functionName = apiRedirect?.to.match(/\/\.netlify\/functions\/([A-Za-z0-9_-]+)/)?.[1];
    expect(functionName).toBe('api');
    expect(config.functions.directory).toBe('netlify/functions');
    const dir = String(config.functions.directory);
    const candidates = [`${dir}/${functionName}.js`, `${dir}/${functionName}.mjs`, `${dir}/${functionName}.ts`];
    const entry = candidates.find((c) => fs.existsSync(path.join(repoRoot, c)));
    expect(entry, `no function entry point in ${dir} for "/${functionName}"`).toBeDefined();

    const source = fs.readFileSync(path.join(repoRoot, String(entry)), 'utf8');
    // The function must delegate to the same Express app the VPS server uses.
    expect(source).toContain('serverlessAdapter');
    expect(source).toContain('handleFetch');
    expect(fs.existsSync(path.join(repoRoot, 'server/lib/serverlessAdapter.js'))).toBe(true);
  });

  it('copies the function instead of flattening it into one bundle', () => {
    // Two failure modes that only exist in the deployment, so no local test of
    // the app itself would ever see them:
    //  1. esbuild + an ESM project + CommonJS dependencies turns express's
    //     `require('path')` (via body-parser/depd) into "Dynamic require of
    //     \"path\" is not supported", thrown on the first cold start.
    //  2. @libsql/client and @aws-sdk/client-s3 resolve platform-specific
    //     optional bindings at require-time, which a single-file bundle cannot
    //     reproduce.
    // `nft` avoids both: it ships the traced module graph as real files.
    expect(config.functions.node_bundler).toBe('nft');
    expect(rawToml).not.toMatch(/node_bundler\s*=\s*"esbuild"/);
    expect(config.functions.external_node_modules).toBeUndefined();
  });

  it('includes the runtime-read migrations, which no bundler can trace', () => {
    // server/migrate.js reads server/migrations/*.sql with fs. That is not an
    // import, so it is not traced and would be missing from the deployed
    // function — which then answers every request with "no such table".
    const included = (config.functions.included_files as string[]) || [];
    expect(included).toContain('/server/migrations/*.sql');

    // Anything the server reads off disk at runtime must be listed here. This
    // walks the real sources, so a new fs-read of a non-imported asset fails
    // the build instead of only failing in production.
    const serverFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith('.js')) serverFiles.push(full);
      }
    };
    walk(path.join(repoRoot, 'server'));
    const readers = serverFiles.filter((file) => /readFileSync|readdirSync/.test(fs.readFileSync(file, 'utf8')));
    expect(readers.length).toBeGreaterThan(0);
    for (const file of readers) {
      const source = fs.readFileSync(file, 'utf8');
      const dirs = source.match(/path\.(?:resolve|join)\([^\n]*?'([A-Za-z_]+)'\s*\)/g) || [];
      for (const found of dirs) {
        const name = found.match(/'([A-Za-z_]+)'\s*\)/)?.[1];
        if (!name) continue;
        expect(
          included.some((glob) => glob.includes(`/${name}/`)),
          `${name}/ is read at runtime by ${path.basename(file)} but not in included_files`
        ).toBe(true);
      }
    }
  });

  it('declares the drivers it relies on as runtime dependencies', () => {
    // Nothing is bundled, so these must exist in the installed tree at runtime.
    // optionalDependencies are installed by `npm ci` and by `--omit=dev`
    // production installs; as devDependencies the function could not open a
    // database connection in production at all.
    for (const name of ['@libsql/client', '@aws-sdk/client-s3']) {
      const declared = pkg.dependencies?.[name] ?? pkg.optionalDependencies?.[name];
      expect(declared, `${name} must be a runtime dependency`).toBeTruthy();
      expect(pkg.devDependencies?.[name]).toBeUndefined();
    }
    expect(pkg.dependencies['serverless-http']).toBeTruthy();
  });

  it('keeps the app build script intact, because Netlify runs it verbatim', () => {
    expect(config.build.command).toBe('npm run build');
    expect(pkg.scripts.build).toBe('tsc -b && vite build');
    expect(pkg.scripts.migrate).toBe('node server/migrate.js');
  });

  it('does not send API-shaped paths to index.html in the SPA fallback test file', () => {
    // The Express side has its own guard (server/lib/spa.js); this checks the
    // deploy config was not edited to drop /api before the catch-all.
    expect(rawToml.indexOf('/api/*')).toBeGreaterThan(-1);
    expect(rawToml.indexOf('/api/*')).toBeLessThan(rawToml.indexOf('from = "/*"'));
  });
});

describe('production config guards', () => {
  // assertProductionConfig() is the difference between a deploy that 500s
  // immediately and one that appears to work, accepts uploads, and then loses
  // the files (or the rate limits) on the next invocation.
  it('refuses a serverless boot that depends on a local disk or process memory', async () => {
    const { config: appConfig, assertProductionConfig } = await import('../../server/config.js');
    const snapshot = {
      serverless: appConfig.isServerless,
      dbDriver: appConfig.db.driver,
      storageDriver: appConfig.storage.driver,
      rateLimitStore: appConfig.rateLimit.store,
    };
    try {
      appConfig.isServerless = true;
      appConfig.db.driver = 'sqlite';
      appConfig.storage.driver = 'fs';
      appConfig.rateLimit.store = 'memory';
      expect(() => assertProductionConfig()).toThrow(/Invalid serverless configuration/);

      // A non-serverless (VPS) deployment is allowed to keep the local disk,
      // which is what "preserve the VPS path" means at boot time.
      appConfig.isServerless = false;
      expect(() => assertProductionConfig()).not.toThrow();

      appConfig.isServerless = true;
      appConfig.db.driver = 'libsql';
      appConfig.db.url = 'libsql://db.test';
      appConfig.db.authToken = 'token';
      appConfig.storage.driver = 's3';
      appConfig.storage.bucket = 'private-bucket';
      appConfig.storage.accessKeyId = 'id';
      appConfig.storage.secretAccessKey = 'secret';
      appConfig.rateLimit.store = 'db';
      expect(() => assertProductionConfig()).not.toThrow();
    } finally {
      appConfig.isServerless = snapshot.serverless;
      appConfig.db.driver = snapshot.dbDriver;
      appConfig.storage.driver = snapshot.storageDriver;
      appConfig.rateLimit.store = snapshot.rateLimitStore;
      appConfig.db.url = undefined;
      appConfig.db.authToken = undefined;
      appConfig.storage.bucket = undefined;
      appConfig.storage.accessKeyId = undefined;
      appConfig.storage.secretAccessKey = undefined;
    }
  });

  it('refuses an incomplete hosted database or bucket config', async () => {
    const { config: appConfig, assertProductionConfig } = await import('../../server/config.js');
    const db = { ...appConfig.db };
    const storage = { ...appConfig.storage };
    try {
      appConfig.db.driver = 'libsql';
      appConfig.db.url = '';
      appConfig.db.authToken = '';
      expect(() => assertProductionConfig()).toThrow(/TURSO_DATABASE_URL[\s\S]*TURSO_DATABASE_TOKEN/);

      appConfig.storage.driver = 's3';
      appConfig.storage.bucket = '';
      appConfig.storage.accessKeyId = '';
      expect(() => assertProductionConfig()).toThrow(/S3_BUCKET/);
    } finally {
      Object.assign(appConfig.db, db);
      Object.assign(appConfig.storage, storage);
    }
  });
});
