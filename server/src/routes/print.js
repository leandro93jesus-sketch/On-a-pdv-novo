import { Router } from 'express';
import { requireAuth, requireAdmin, authOptional } from '../middleware/auth.js';
import {
  enqueuePrintJob,
  listPrintJobs,
  getPrintJob,
  markPrintJobResult,
  requeuePrintJob,
  listPrintLog,
  logDirectPrint,
} from '../services/printQueueService.js';

const router = Router();

router.get('/jobs', authOptional, (req, res, next) => {
  try {
    res.json(listPrintJobs({ status: req.query.status, limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', requireAuth, (req, res, next) => {
  try {
    const job = enqueuePrintJob({ ...req.body, user_name: req.user?.name });
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:id', authOptional, (req, res, next) => {
  try {
    res.json(getPrintJob(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/result', requireAuth, (req, res, next) => {
  try {
    res.json(
      markPrintJobResult(req.params.id, {
        ok: Boolean(req.body?.ok),
        error: req.body?.error,
        printer_name: req.body?.printer_name,
        user_name: req.user?.name,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/requeue', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(requeuePrintJob(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/log', authOptional, (req, res, next) => {
  try {
    res.json(listPrintLog({ limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.post('/log', requireAuth, (req, res, next) => {
  try {
    logDirectPrint({ ...req.body, user_name: req.user?.name });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
