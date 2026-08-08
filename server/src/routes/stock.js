import { Router } from 'express';
import {
  createManualStockMovement,
  listStock,
  listStockMovements,
} from '../services/stockService.js';

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

router.post('/movements', (req, res, next) => {
  try {
    const result = createManualStockMovement(req.body ?? {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
