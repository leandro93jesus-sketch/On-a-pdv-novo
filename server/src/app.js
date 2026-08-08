import express from 'express';
import cors from 'cors';
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
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import reportsRouter from './routes/reports.js';
import backupsRouter from './routes/backups.js';
import importsRouter from './routes/imports.js';
import receiptsRouter from './routes/receipts.js';
import auditRouter from './routes/audit.js';
import { authOptional } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

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
  app.use('/api/audit', auditRouter);
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

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
