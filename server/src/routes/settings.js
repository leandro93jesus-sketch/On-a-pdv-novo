import { Router } from 'express';
import { getSettingsBundle, updateSettings, listAllSettingsRaw } from '../services/settingsAppService.js';
import { getLogoMeta, readLogoBuffer, saveLogoFromBase64, removeLogo } from '../services/logoService.js';
import {
  getPrinterSettings,
  updatePrinterSettings,
  resolvePrinterFor,
} from '../services/printerSettingsService.js';
import {
  exportPortablePrinterConfig,
  importPortablePrinterConfig,
  matchPrintersOnHost,
  savePortablePrinterConfigFile,
} from '../services/portablePrinterConfigService.js';
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

router.get('/logo', authOptional, (_req, res, next) => {
  try {
    const file = readLogoBuffer();
    if (!file) {
      return res.status(404).json({ error: 'Logo não configurado', code: 'LOGO_NOT_FOUND' });
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(file.buffer);
  } catch (err) {
    next(err);
  }
});

router.get('/logo/meta', authOptional, (_req, res) => {
  res.json(getLogoMeta());
});

router.post('/logo', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const meta = saveLogoFromBase64({
      filename: req.body?.filename,
      content_base64: req.body?.content_base64,
      userName: req.user?.name,
    });
    res.status(201).json(meta);
  } catch (err) {
    next(err);
  }
});

router.delete('/logo', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(removeLogo({ userName: req.user?.name }));
  } catch (err) {
    next(err);
  }
});

router.get('/printers', authOptional, (_req, res) => {
  res.json(getPrinterSettings());
});

router.put('/printers', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const saved = updatePrinterSettings(req.body || {}, req.user?.name);
    try {
      savePortablePrinterConfigFile();
    } catch {
      /* arquivo portátil é best-effort */
    }
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.get('/printers/resolve', authOptional, (req, res) => {
  const kind = String(req.query.kind || 'receipt');
  res.json(resolvePrinterFor(kind));
});

router.get('/printers/export', requireAuth, requireAdmin, (_req, res, next) => {
  try {
    res.json(exportPortablePrinterConfig());
  } catch (err) {
    next(err);
  }
});

router.post('/printers/import', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(importPortablePrinterConfig(req.body || {}, req.user?.name));
  } catch (err) {
    next(err);
  }
});

router.post('/printers/match', authOptional, (req, res, next) => {
  try {
    const names = Array.isArray(req.body?.printers)
      ? req.body.printers.map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean)
      : [];
    res.json(matchPrintersOnHost(names));
  } catch (err) {
    next(err);
  }
});

export default router;
