import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { migrate } from './migrate.js';
import { helmetMiddleware, originCheck, generalLimiter } from './middleware/security.js';
import { attachActors } from './middleware/auth.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { config } from './config.js';

import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import filesRoutes from './routes/files.js';
import adminClientsRoutes from './routes/admin/clients.js';
import adminInvoicesRoutes from './routes/admin/invoices.js';
import adminPaymentsRoutes from './routes/admin/payments.js';
import adminReviewRoutes from './routes/admin/review.js';
import adminSettingsRoutes from './routes/admin/settings.js';
import adminDashboardRoutes from './routes/admin/dashboard.js';
import adminSecurityRoutes from './routes/admin/security.js';
import adminReportsRoutes from './routes/admin/reports.js';
import clientPortalRoutes from './routes/client/portal.js';

/**
 * Build the Express application. `spaHandler` (optional) serves the built
 * frontend / dev-server middleware and must be mounted after the API routes.
 */
export function createApp({ spaHandler } = {}) {
  migrate();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmetMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(originCheck);
  app.use('/api', generalLimiter());
  app.use(attachActors);

  // ------------------------------------------------------------- API routes
  app.use('/api', publicRoutes);
  app.use('/api', authRoutes);
  app.use('/api', filesRoutes);
  app.use('/api/admin', adminClientsRoutes);
  app.use('/api/admin', adminInvoicesRoutes);
  app.use('/api/admin', adminPaymentsRoutes);
  app.use('/api/admin', adminReviewRoutes);
  app.use('/api/admin', adminSettingsRoutes);
  app.use('/api/admin', adminDashboardRoutes);
  app.use('/api/admin', adminSecurityRoutes);
  app.use('/api/admin', adminReportsRoutes);
  app.use('/api/client', clientPortalRoutes);

  // ------------------------------------------------------------ SPA serving
  if (spaHandler) {
    app.use(spaHandler);
  } else if (config.isProduction) {
    const distDir = path.join(config.rootDir, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
