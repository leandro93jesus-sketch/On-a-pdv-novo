import { Router } from 'express';
import {
  cancelPurchase,
  completePurchase,
  createPurchase,
  getPurchaseById,
  listPurchases,
} from '../services/purchasesService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(
      listPurchases({
        limit: req.query.limit,
        status: req.query.status,
        supplierId: req.query.supplier_id,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(getPurchaseById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(createPurchase(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/complete', (req, res, next) => {
  try {
    res.json(completePurchase(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    res.json(cancelPurchase(Number(req.params.id), req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
