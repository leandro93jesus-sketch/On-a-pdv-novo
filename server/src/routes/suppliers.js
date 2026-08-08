import { Router } from 'express';
import {
  createSupplier,
  getSupplierById,
  getSupplierPurchaseHistory,
  inactivateSupplier,
  searchSuppliers,
  updateSupplier,
} from '../services/suppliersService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(
      searchSuppliers({
        q: req.query.q,
        includeInactive: req.query.include_inactive === '1' || req.query.include_inactive === 'true',
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(getSupplierById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/purchases', (req, res, next) => {
  try {
    res.json(getSupplierPurchaseHistory(Number(req.params.id), { limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(createSupplier(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    res.json(updateSupplier(Number(req.params.id), req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/inactivate', (req, res, next) => {
  try {
    res.json(inactivateSupplier(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

export default router;
