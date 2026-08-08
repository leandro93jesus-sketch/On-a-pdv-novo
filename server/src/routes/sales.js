import { Router } from 'express';
import { createSale, getSaleById, listSales } from '../services/salesService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const sales = listSales({ limit: req.query.limit });
    res.json(sales);
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
    const sale = getSaleById(id);
    res.json(sale);
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

export default router;
