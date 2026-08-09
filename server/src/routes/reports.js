import { Router } from 'express';
import { listReportCatalog, runReport } from '../services/reportsService.js';
import { authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/', authOptional, (_req, res) => {
  res.json(listReportCatalog());
});

router.get('/:id', authOptional, (req, res, next) => {
  try {
    const report = runReport(req.params.id, req.query || {});
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post('/:id', authOptional, (req, res, next) => {
  try {
    const report = runReport(req.params.id, { ...(req.query || {}), ...(req.body || {}) });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
