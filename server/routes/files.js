import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { get } from '../db.js';
import { asyncHandler, notFound, forbidden, unauthorized } from '../lib/http.js';
import { attachActors } from '../middleware/auth.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(attachActors);

/**
 * Stream a stored receipt. Only the owning client or an administrator may
 * access a receipt. Files are never served from a public static directory.
 */
router.get(
  '/files/receipts/:id',
  asyncHandler(async (req, res) => {
    const receipt = get('SELECT * FROM receipts WHERE id = ?', [req.params.id]);
    if (!receipt) throw notFound('File not found.');

    const isAdmin = !!req.admin;
    const isOwner = !!req.portalClient && req.portalClient.id === receipt.client_id;
    if (!isAdmin && !isOwner) {
      if (!req.admin && !req.portalClient) {
        throw unauthorized('Sign in to view this file.');
      }
      throw forbidden('You are not authorized to view this file.');
    }

    const resolved = path.resolve(config.uploadDir, receipt.stored_filename);
    const root = path.resolve(config.uploadDir);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      throw notFound('File not found.');
    }

    audit(req, {
      action: isAdmin ? 'receipt_viewed_by_admin' : 'receipt_viewed_by_client',
      entity: 'receipt',
      entityId: receipt.id,
    });

    res.setHeader('Content-Type', receipt.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${receipt.original_filename.replace(/[^\w.\-]+/g, '_')}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(resolved).pipe(res);
  })
);

export default router;
