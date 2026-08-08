import { Router } from 'express';
import {
  parseLegacyJsonBuffer,
  createPreviewRun,
  executeImport,
  listImportRuns,
  getImportRun,
} from '../services/legacyImportService.js';
import { requireAuth, requireAdmin, authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/', authOptional, (_req, res, next) => {
  try {
    res.json(listImportRuns());
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authOptional, (req, res, next) => {
  try {
    res.json(getImportRun(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

/** Preview: body { filename, content_base64 } ou { json } */
router.post('/preview', requireAuth, requireAdmin, (req, res, next) => {
  try {
    let buffer;
    let filename = req.body?.filename || 'backup.json';
    if (req.body?.content_base64) {
      buffer = Buffer.from(req.body.content_base64, 'base64');
    } else if (req.body?.json != null) {
      buffer = Buffer.from(
        typeof req.body.json === 'string' ? req.body.json : JSON.stringify(req.body.json),
        'utf8'
      );
    } else {
      return res.status(400).json({ error: 'Envie content_base64 ou json', code: 'VALIDATION' });
    }
    const parsed = parseLegacyJsonBuffer(buffer, { filename });
    const run = createPreviewRun(parsed, { createdBy: req.user?.name });
    // Mantém parsed em memória não é necessário — reenvia no commit
    res.status(201).json({
      ...run,
      analysis: parsed.analysis,
      // Para commit posterior o cliente reenvia o arquivo
    });
  } catch (err) {
    next(err);
  }
});

router.post('/execute', requireAuth, requireAdmin, (req, res, next) => {
  try {
    let buffer;
    let filename = req.body?.filename || 'backup.json';
    if (req.body?.content_base64) {
      buffer = Buffer.from(req.body.content_base64, 'base64');
    } else if (req.body?.json != null) {
      buffer = Buffer.from(
        typeof req.body.json === 'string' ? req.body.json : JSON.stringify(req.body.json),
        'utf8'
      );
    } else {
      return res.status(400).json({ error: 'Envie content_base64 ou json', code: 'VALIDATION' });
    }
    const parsed = parseLegacyJsonBuffer(buffer, { filename });
    const result = executeImport(parsed, {
      createdBy: req.user?.name,
      confirm: Boolean(req.body?.confirm),
      runId: req.body?.run_id ? Number(req.body.run_id) : null,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
