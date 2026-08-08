import { isAppError } from '../utils/errors.js';

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

  console.error('[onca-pdv] erro não tratado:', err);
  res.status(500).json({
    error: 'Erro interno do servidor',
    code: 'INTERNAL_ERROR',
  });
}
