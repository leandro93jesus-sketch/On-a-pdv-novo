import { Router } from 'express';
import { buildDiagnosticReport, getSupportDiagnostics } from '../services/supportService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/diagnostics', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getSupportDiagnostics());
  } catch (err) {
    next(err);
  }
});

router.post('/diagnostic-report', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await buildDiagnosticReport());
  } catch (err) {
    next(err);
  }
});

export default router;
