import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import productsRouter from './routes/products.js';
import salesRouter from './routes/sales.js';
import stockRouter from './routes/stock.js';
import cashRouter from './routes/cash.js';
import customersRouter from './routes/customers.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/customers', customersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
