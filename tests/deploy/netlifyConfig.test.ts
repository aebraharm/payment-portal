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
      if (literal.startsWith('"')) value = JSON.parse(literal) as string;
      else if (/^-?\d+(\.\d+)?$/.test(literal)) value = Number(literal);
      else if (literal === 'true' || literal === 'false') value = literal === 'true';
      current[pair[1].trim()] = value;
    }
  }
  return out;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readToml = () => parseToml(fs.readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8'));
const config = readToml();

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
