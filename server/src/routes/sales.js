import { Router } from 'express';
import { cancelSale, createSale, getSaleById, listSales } from '../services/salesService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(listSales({ limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(getSaleById(id));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const sale = createSale(req.body ?? {});
    res.status(201).json(sale);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(cancelSale(id, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
