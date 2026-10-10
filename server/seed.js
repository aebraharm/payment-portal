import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';
import { run, get, all, isoNow } from './db.js';
import { hashPassword } from './lib/tokens.js';
import { DEFAULT_SETTINGS } from './lib/settings.js';
import { config } from './config.js';
import { CARD_LABEL } from './lib/paymentConfig.js';

const DEFAULT_CURRENCIES = [
  { code: 'USD', name: 'United States Dollar', symbol: '$', sort_order: 1 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', sort_order: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', sort_order: 3 },
  { code: 'GBP', name: 'British Pound Sterling', symbol: '£', sort_order: 4 },
];

const DEFAULT_METHODS = [
  { code: 'bank_transfer', name: 'Bank Transfer', enabled: 1, sort_order: 1, config: {} },
  { code: 'western_union', name: 'Western Union', enabled: 1, sort_order: 2, config: {} },
  {
    code: 'card',
    name: 'Card Payment',
    enabled: 0,
    sort_order: 3,
    config: { label: CARD_LABEL, processorName: null, regionVerified: false, processorIntegrated: false },
  },
];

/**
 * Idempotent bootstrap:
 *  - runs migrations
 *  - seeds default currencies / payment methods / settings ONLY when missing
 *    (re-running never overwrites administrator changes)
 *  - creates the initial administrator from ADMIN_EMAIL / ADMIN_PASSWORD env
 *    vars exactly once; an existing administrator's password is NEVER reset.
 */
export async function seedDatabase() {
  await migrate();
  const now = isoNow();

  for (const c of DEFAULT_CURRENCIES) {
    const existing = await get('SELECT code FROM currencies WHERE code = ?', [c.code]);
    if (!existing) {
      await run('INSERT INTO currencies (code, name, symbol, enabled, sort_order) VALUES (?, ?, ?, 1, ?)', [
        c.code,
        c.name,
        c.symbol,
        c.sort_order,
      ]);
    }
  }

  for (const m of DEFAULT_METHODS) {
    const existing = await get('SELECT code FROM payment_methods WHERE code = ?', [m.code]);
    if (!existing) {
      await run(
        'INSERT INTO payment_methods (code, name, enabled, sort_order, config, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [m.code, m.name, m.enabled, m.sort_order, JSON.stringify(m.config), now]
      );
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await get('SELECT key FROM settings WHERE key = ?', [key]);
    if (!existing) {
      await run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, JSON.stringify(value), now]);
    }
  }

  const wu = await get('SELECT id FROM western_union_config WHERE id = 1');
  if (!wu) {
    await run(
      `INSERT INTO western_union_config (id, display_name, currencies, countries, required_sender_info, required_recipient_info, mtcn_required, receipt_required, enabled, updated_at)
       VALUES (1, 'Western Union', '[]', '[]', '[]', '[]', 1, 1, 0, ?)`,
      [now]
    );
  }

  // Bootstrap administrator — created once, never reset by re-running seed.
  // Both ADMIN_EMAIL and ADMIN_PASSWORD must be provided via the environment;
  // there is deliberately NO built-in default, so a deployment can never
  // silently create an administrator with a publicly documented identity.
  const adminEmail = config.adminBootstrap.email;
  const adminPassword = config.adminBootstrap.password;
  const missing = [
    ...(adminEmail ? [] : ['ADMIN_EMAIL']),
    ...(adminPassword ? [] : ['ADMIN_PASSWORD']),
  ];
  if (missing.length > 0) {
    console.warn(
      `[seed] WARNING: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. ` +
        'No administrator account was created. Set both in the environment (never commit real ' +
        'credentials to source control) and run `npm run seed` again.'
    );
  } else {
    const existingAdmin = await get('SELECT id FROM admins WHERE email = ?', [adminEmail]);
    if (!existingAdmin) {
      await run(
        `INSERT INTO admins (email, password_hash, role, full_name, status, must_change_password, created_at, updated_at)
         VALUES (?, ?, 'superadmin', 'Portal Administrator', 'active', 1, ?, ?)`,
        [adminEmail, hashPassword(adminPassword), now, now]
      );
      console.log(`[seed] bootstrap administrator created: ${adminEmail} (password change required on first login)`);
    } else {
      console.log(`[seed] administrator ${adminEmail} already exists — left unchanged (idempotent).`);
    }
  }

  const counts = {
    admins: (await get('SELECT COUNT(*) AS n FROM admins')).n,
    clients: (await get('SELECT COUNT(*) AS n FROM clients')).n,
    currencies: (await get('SELECT COUNT(*) AS n FROM currencies')).n,
    paymentMethods: (await get('SELECT COUNT(*) AS n FROM payment_methods')).n,
  };
  return counts;
}

// Allow running directly: `node server/seed.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then((counts) => {
      console.log('[seed] done:', counts);
    })
    .catch((err) => {
      console.error('[seed] failed:', err);
      process.exit(1);
    });
}

void all;
