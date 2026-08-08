import { Router } from 'express';
import {
  closeCashSession,
  getCashConference,
  getOpenCashSession,
  listCashMovements,
  listCashSessions,
  openCashSession,
  registerCashMovement,
} from '../services/cashService.js';

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

router.post('/movements', (req, res, next) => {
  try {
    res.status(201).json(registerCashMovement(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
