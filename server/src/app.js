import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import healthRouter from './routes/health.js';
import productsRouter from './routes/products.js';
import salesRouter from './routes/sales.js';
import stockRouter from './routes/stock.js';
import cashRouter from './routes/cash.js';
import customersRouter from './routes/customers.js';
import suppliersRouter from './routes/suppliers.js';
import purchasesRouter from './routes/purchases.js';
import creditRouter from './routes/credit.js';
import returnsRouter from './routes/returns.js';
import deliveriesRouter from './routes/deliveries.js';
import deliveryOrdersRouter from './routes/deliveryOrders.js';
import printRouter from './routes/print.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import reportsRouter from './routes/reports.js';
import backupsRouter from './routes/backups.js';
import importsRouter from './routes/imports.js';
import receiptsRouter from './routes/receipts.js';
import quotesRouter from './routes/quotes.js';
import auditRouter from './routes/audit.js';
import exportRouter from './routes/export.js';
import supportRouter from './routes/support.js';
import { authOptional } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveWebDist() {
  if (process.env.PDV_WEB_DIST) return process.env.PDV_WEB_DIST;
  return join(__dirname, '../../web/dist');
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100mb' }));
  app.use(authOptional);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/backups', backupsRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/receipts', receiptsRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/credit', creditRouter);
  app.use('/api/returns', returnsRouter);
  app.use('/api/deliveries', deliveriesRouter);
  app.use('/api/delivery-orders', deliveryOrdersRouter);
  app.use('/api/print', printRouter);

  const webDist = resolveWebDist();
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      return res.sendFile(join(webDist, 'index.html'), (err) => {
        if (err) next();
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
