import { Router } from 'express';
import { buildDiagnosticReport, getSupportDiagnostics } from '../services/supportService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/diagnostics', requireAuth, requireAdmin, (_req, res) => {
  res.json(getSupportDiagnostics());
});

router.post('/diagnostic-report', requireAuth, requireAdmin, (_req, res) => {
  res.json(buildDiagnosticReport());
});

export default router;
