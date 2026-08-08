import { Router } from 'express';
import { exportDatasetCsv, listExportDatasets } from '../services/exportService.js';
import { requireAdminSensitive } from '../middleware/auth.js';

const router = Router();

router.get('/datasets', requireAdminSensitive, (_req, res) => {
  res.json({ datasets: listExportDatasets(), formats: ['csv'] });
});

router.get('/:dataset.csv', requireAdminSensitive, (req, res, next) => {
  try {
    const file = exportDatasetCsv(req.params.dataset);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.content);
  } catch (err) {
    next(err);
  }
});

router.post('/:dataset', requireAdminSensitive, (req, res, next) => {
  try {
    const file = exportDatasetCsv(req.params.dataset);
    res.json(file);
  } catch (err) {
    next(err);
  }
});

export default router;
