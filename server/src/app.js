import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import productsRouter from './routes/products.js';
import salesRouter from './routes/sales.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/sales', salesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
