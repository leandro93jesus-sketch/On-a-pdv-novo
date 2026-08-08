import { Router } from 'express';
import {
  getCreditAccountById,
  getCreditSummary,
  listCreditAccounts,
  registerCreditPayment,
  reverseCreditPayment,
} from '../services/creditService.js';

const router = Router();

router.get('/summary', (req, res, next) => {
  try {
    res.json(getCreditSummary());
  } catch (err) {
    next(err);
  }
});

router.get('/accounts', (req, res, next) => {
  try {
    res.json(
      listCreditAccounts({
        status: req.query.status,
        customerId: req.query.customer_id,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/accounts/:id', (req, res, next) => {
  try {
    res.json(getCreditAccountById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/payments', (req, res, next) => {
  try {
    res.status(201).json(registerCreditPayment(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/payments/:id/reverse', (req, res, next) => {
  try {
    res.json(reverseCreditPayment(Number(req.params.id), req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
