import { isAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Rota não encontrada', code: 'NOT_FOUND' });
}

export function errorHandler(err, _req, res, _next) {
  if (isAppError(err)) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }

  logger.error('erro não tratado', {
    message: err?.message,
    stack: String(err?.stack || '').slice(0, 2000),
  });
  console.error('[onca-pdv] erro não tratado:', err);
  res.status(500).json({
    error: 'Erro interno do servidor',
    code: 'INTERNAL_ERROR',
  });
}
