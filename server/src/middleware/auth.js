import { AppError } from '../utils/errors.js';
import { resolveSession, userCan } from '../services/authService.js';

export function extractBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h) return null;
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Anexa req.user se houver token válido; não bloqueia. */
export function authOptional(req, _res, next) {
  try {
    const token = extractBearer(req);
    const session = resolveSession(token);
    if (session) {
      req.user = session.user;
      req.authToken = token;
    }
  } catch {
    /* ignore */
  }
  next();
}

export function requireAuth(req, _res, next) {
  const token = extractBearer(req);
  const session = resolveSession(token);
  if (!session) {
    return next(new AppError('Autenticação necessária', { status: 401, code: 'AUTH_REQUIRED' }));
  }
  req.user = session.user;
  req.authToken = token;
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) {
    return next(new AppError('Autenticação necessária', { status: 401, code: 'AUTH_REQUIRED' }));
  }
  if (req.user.role !== 'administrador') {
    return next(new AppError('Acesso restrito a administradores', { status: 403, code: 'FORBIDDEN' }));
  }
  next();
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Autenticação necessária', { status: 401, code: 'AUTH_REQUIRED' }));
    }
    if (!userCan(req.user, permission)) {
      return next(new AppError('Permissão insuficiente', { status: 403, code: 'FORBIDDEN' }));
    }
    next();
  };
}
