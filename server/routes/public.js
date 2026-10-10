import { Router } from 'express';
import path from 'node:path';
import { asyncHandler } from '../lib/http.js';
import { getPublicBranding, getEnabledCurrencies, getEnabledPaymentMethods, getSetting } from '../lib/settings.js';
import { storedFileExists, streamStoredFile } from '../lib/storage.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/** Public branding + enabled currencies/methods. Contains no secrets. */
router.get(
  '/public/branding',
  asyncHandler(async (_req, res) => {
    const branding = await getPublicBranding();
    const currencies = await getEnabledCurrencies();
    const methods = await getEnabledPaymentMethods();
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
      receiptMaxSizeMb: Number(await getSetting('receipt_max_size_mb')) || 10,
      allowedReceiptTypes: await getSetting('allowed_receipt_types') || ['pdf', 'jpg', 'jpeg', 'png'],
    });
  })
);

/** Public logo stream (branding asset only, no financial data). */
router.get(
  '/public/branding/logo',
  asyncHandler(async (_req, res) => {
    const logoPath = await getSetting('logo_path');
    if (!logoPath) {
      res.status(404).json({ error: { code: 'not_found', message: 'No logo configured.' } });
      return;
    }
    if (!(await storedFileExists(logoPath))) {
      res.status(404).json({ error: { code: 'not_found', message: 'No logo configured.' } });
      return;
    }
    const ext = path.extname(logoPath).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    await streamStoredFile(logoPath, res);
  })
);

export default router;
