import { Router } from 'express';
import {
  createManualStockMovement,
  listStock,
  listStockMovements,
  setStockBalance,
  getProductStockHistory,
} from '../services/stockService.js';
import { requireAdminSensitive } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const onlyAlerts = req.query.alerts === '1' || req.query.alerts === 'true';
    res.json(listStock({ q: req.query.q, onlyAlerts }));
  } catch (err) {
    next(err);
  }
});

router.get('/movements', (req, res, next) => {
  try {
    res.json(
      listStockMovements({
        productId: req.query.product_id ? Number(req.query.product_id) : undefined,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/movements', requireAdminSensitive, (req, res, next) => {
  try {
    const result = createManualStockMovement(req.body ?? {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/set-balance', requireAdminSensitive, (req, res, next) => {
  try {
    const result = setStockBalance(req.body ?? {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/history/:productId', (req, res, next) => {
  try {
    const id = Number(req.params.productId);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(getProductStockHistory(id, { limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

export default router;
