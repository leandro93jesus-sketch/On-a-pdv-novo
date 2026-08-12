import { Router } from 'express';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  createBackup,
  listBackups,
  getBackupById,
  previewRestore,
  restoreBackup,
  validateBackupFile,
  getBackupDir,
  getActiveDbInfo,
  registerUploadedBackup,
} from '../services/backupService.js';
import { requireAuth, requireAdmin, authOptional } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/', authOptional, (_req, res, next) => {
  try {
    res.json(listBackups());
  } catch (err) {
    next(err);
  }
});

/** Banco ativo usado pela API — obrigatório para diagnóstico de restauração. */
router.get('/active-db', authOptional, (_req, res, next) => {
  try {
    res.json(getActiveDbInfo());
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
      allow_overwrite_newer_data: Boolean(req.body?.allow_overwrite_newer_data),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Upload de .db/.sqlite para pasta de backups — registra no histórico. */
router.post('/upload', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const { filename, content_base64 } = req.body || {};
    if (!filename || !content_base64) {
      throw new AppError('filename e content_base64 obrigatórios', {
        status: 400,
        code: 'VALIDATION',
      });
    }
    const lower = String(filename).toLowerCase();
    if (lower.endsWith('.json')) {
      throw new AppError(
        'Arquivo JSON detectado. Use a aba IMPORTAR BACKUP ANTIGO JSON.',
        { status: 400, code: 'WRONG_BACKUP_TYPE_JSON' }
      );
    }
    const ext = extname(lower);
    if (!['.db', '.sqlite'].includes(ext)) {
      throw new AppError('Apenas arquivos .db ou .sqlite para restauração SQLite', {
        status: 400,
        code: 'VALIDATION',
      });
    }
    const dir = getBackupDir();
    mkdirSync(dir, { recursive: true });
    const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filepath = join(dir, `upload-${Date.now()}-${safe}`);
    writeFileSync(filepath, Buffer.from(content_base64, 'base64'));
    const registered = registerUploadedBackup(filepath, {
      createdBy: req.user?.name,
      originalName: filename,
    });
    const preview = previewRestore(filepath);
    res.status(201).json({
      ...registered,
      preview,
      message: 'Arquivo validado e registrado. Revise a prévia antes de restaurar.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
