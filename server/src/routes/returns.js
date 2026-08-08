import { Router } from 'express';
import { createReturn, getReturnById, listReturns } from '../services/returnsService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(listReturns({ limit: req.query.limit, saleId: req.query.sale_id }));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(getReturnById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(createReturn(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
