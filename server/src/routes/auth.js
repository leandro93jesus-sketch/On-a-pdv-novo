import { Router } from 'express';
import {
  login,
  logout,
  listUsers,
  createUser,
  updateUser,
  changePassword,
  getUserById,
  ensureBootstrapAdmin,
} from '../services/authService.js';
import { extractBearer, requireAuth, requireAdmin } from '../middleware/auth.js';
import { verifyAdminOperationPin } from '../services/adminAuthService.js';

const router = Router();

router.post('/login', (req, res, next) => {
  try {
    const result = login(
      { login: req.body?.login, password: req.body?.password },
      { ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  try {
    res.json(logout(extractBearer(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** Valida PIN de operação administrativa (não devolve a senha). */
router.post('/verify-admin-pin', requireAuth, (req, res, next) => {
  try {
    const result = verifyAdminOperationPin(req.body?.password ?? req.body?.pin);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAuth, (req, res, next) => {
  try {
    const user = changePassword(req.user.id, {
      currentPassword: req.body?.current_password,
      newPassword: req.body?.new_password,
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get('/users', requireAuth, requireAdmin, (_req, res, next) => {
  try {
    ensureBootstrapAdmin();
    res.json(listUsers({ includeInactive: true }));
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const user = createUser(req.body || {});
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(updateUser(Number(req.params.id), req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/password', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const user = changePassword(
      Number(req.params.id),
      { newPassword: req.body?.new_password },
      { asAdmin: true }
    );
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const user = getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'Não encontrado', code: 'NOT_FOUND' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
