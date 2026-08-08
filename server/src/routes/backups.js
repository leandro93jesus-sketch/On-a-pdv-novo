import { Router } from 'express';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createBackup,
  listBackups,
  getBackupById,
  previewRestore,
  restoreBackup,
  validateBackupFile,
  getBackupDir,
} from '../services/backupService.js';
import { requireAuth, requireAdmin, authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/', authOptional, (_req, res, next) => {
  try {
    res.json(listBackups());
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const backup = createBackup({
      kind: 'manual',
      createdBy: req.user?.name,
      notes: req.body?.notes || null,
    });
    res.status(201).json(backup);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authOptional, (req, res, next) => {
  try {
    res.json(getBackupById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/validate', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const filePath = req.body?.filepath;
    res.json(validateBackupFile(filePath));
  } catch (err) {
    next(err);
  }
});

router.post('/restore/preview', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(previewRestore(req.body?.filepath));
  } catch (err) {
    next(err);
  }
});

router.post('/restore', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const result = restoreBackup(req.body?.filepath, {
      createdBy: req.user?.name,
      confirm: Boolean(req.body?.confirm),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Upload de arquivo .db para pasta de backups (base64) — evita multipart nativo. */
router.post('/upload', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const { filename, content_base64 } = req.body || {};
    if (!filename || !content_base64) {
      return res.status(400).json({ error: 'filename e content_base64 obrigatórios', code: 'VALIDATION' });
    }
    if (!String(filename).toLowerCase().endsWith('.db')) {
      return res.status(400).json({ error: 'Apenas arquivos .db', code: 'VALIDATION' });
    }
    const dir = getBackupDir();
    mkdirSync(dir, { recursive: true });
    const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filepath = join(dir, safe);
    writeFileSync(filepath, Buffer.from(content_base64, 'base64'));
    const validation = validateBackupFile(filepath);
    res.status(201).json({ filepath, ...validation });
  } catch (err) {
    next(err);
  }
});

export default router;
