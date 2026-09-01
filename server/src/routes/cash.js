import { Router } from 'express';
import {
  adjustClosedCashSession,
  closeCashSession,
  getCashConference,
  getOpenCashSession,
  listCashMovements,
  listCashSessions,
  openCashSession,
  registerCashMovement,
  reprintCashClosing,
} from '../services/cashService.js';
import {
  buildCashClosingFilename,
  buildCashClosingPdf,
} from '../services/cashClosingPdfService.js';
import { requireAdminSensitive } from '../middleware/auth.js';

const router = Router();

router.get('/sessions', (req, res, next) => {
  try {
    res.json(listCashSessions({ limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/current', (req, res, next) => {
  try {
    const session = getOpenCashSession(req.query.terminal_id);
    res.json(session || null);
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/:id', (req, res, next) => {
  try {
    res.json(getCashConference(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/:id/movements', (req, res, next) => {
  try {
    res.json(listCashMovements(Number(req.params.id), { limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/:id/reprint', (req, res, next) => {
  try {
    res.json(reprintCashClosing(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

// PDF do fechamento (somente leitura; não altera caixa nem venda).
router.get('/sessions/:id/pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const buffer = await buildCashClosingPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${buildCashClosingFilename(id)}"`
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/open', (req, res, next) => {
  try {
    res.status(201).json(openCashSession(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/close', (req, res, next) => {
  try {
    res.json(closeCashSession(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/:id/adjust', requireAdminSensitive, (req, res, next) => {
  try {
    res.json(
      adjustClosedCashSession(Number(req.params.id), {
        ...req.body,
        user_name: req.user?.name || req.body?.user_name,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/movements', (req, res, next) => {
  try {
    res.status(201).json(registerCashMovement(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
