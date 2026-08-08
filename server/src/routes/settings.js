import { Router } from 'express';
import { getSettingsBundle, updateSettings, listAllSettingsRaw } from '../services/settingsAppService.js';
import { requireAuth, requireAdmin, authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/', authOptional, (_req, res) => {
  res.json(getSettingsBundle());
});

router.get('/raw', requireAuth, requireAdmin, (_req, res) => {
  res.json(listAllSettingsRaw());
});

router.put('/', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const bundle = updateSettings(req.body || {}, req.user?.name);
    res.json(bundle);
  } catch (err) {
    next(err);
  }
});

export default router;
