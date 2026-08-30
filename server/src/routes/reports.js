import { Router } from 'express';
import { listReportCatalog, runReport } from '../services/reportsService.js';
import {
  buildReportCsv,
  buildReportPdf,
  buildReportPdfFilename,
} from '../services/reportExportService.js';
import { authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/', authOptional, (_req, res) => {
  res.json(listReportCatalog());
});

// Exportações precisam vir antes de '/:id' para não serem capturadas por ele.
router.get('/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const buffer = await buildReportPdf(req.params.id, req.query || {});
    const filename = buildReportPdfFilename(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/csv', authOptional, (req, res, next) => {
  try {
    const { content, filename, mime } = buildReportCsv(req.params.id, req.query || {});
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
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
