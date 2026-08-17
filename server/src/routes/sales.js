import { Router } from 'express';
import { amendSale, cancelSale, createSale, getSaleById, listSales } from '../services/salesService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const result = listSales({
      limit: req.query.limit,
      offset: req.query.offset,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
      period: req.query.period,
      payment_method: req.query.payment_method,
      status: req.query.status,
      operator: req.query.operator,
      sale_number: req.query.sale_number,
      customer: req.query.customer,
    });
    // Compat: array puro se não pedir paginação explícita; objeto se paged=1 ou offset informado
    const wantPaged =
      req.query.paged === '1' ||
      req.query.offset != null ||
      req.query.include_total === '1';
    if (wantPaged) {
      res.set('X-Total-Count', String(result.total));
      return res.json(result);
    }
    res.set('X-Total-Count', String(result.total));
    res.json(result.items);
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

router.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(amendSale(id, req.body ?? {}));
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
