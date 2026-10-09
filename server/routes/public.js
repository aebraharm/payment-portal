import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { asyncHandler } from '../lib/http.js';
import { getPublicBranding, getEnabledCurrencies, getEnabledPaymentMethods, getSetting } from '../lib/settings.js';
import { config } from '../config.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/** Public branding + enabled currencies/methods. Contains no secrets. */
router.get(
  '/public/branding',
  asyncHandler(async (_req, res) => {
    const branding = getPublicBranding();
    const currencies = getEnabledCurrencies();
    const methods = getEnabledPaymentMethods();
    const cardConfig = methods.find((m) => m.code === 'card');
    res.json({
      branding,
      currencies,
      paymentMethods: methods.map((m) => ({
        code: m.code,
        name: m.name,
        // Card payments are not available in this version. The label is fixed
        // and the option is always presented as unavailable to clients.
        available: m.code !== 'card',
        ...(m.code === 'card'
          ? { label: 'Not available in your region', enabled: !!cardConfig?.enabled }
          : {}),
      })),
      cardLabel: 'Not available in your region',
      receiptMaxSizeMb: Number(getSetting('receipt_max_size_mb')) || 10,
      allowedReceiptTypes: getSetting('allowed_receipt_types') || ['pdf', 'jpg', 'jpeg', 'png'],
    });
  })
);

/** Public logo stream (branding asset only, no financial data). */
router.get(
  '/public/branding/logo',
  asyncHandler(async (_req, res) => {
    const logoPath = getSetting('logo_path');
    if (!logoPath) {
      res.status(404).json({ error: { code: 'not_found', message: 'No logo configured.' } });
      return;
    }
    const resolved = path.resolve(config.uploadDir, logoPath);
    const root = path.resolve(config.uploadDir);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: { code: 'not_found', message: 'No logo configured.' } });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    fs.createReadStream(resolved).pipe(res);
  })
);

export default router;
