import { Router } from 'express';
import {
  createCustomer,
  getCustomerById,
  getCustomerPurchaseHistory,
  inactivateCustomer,
  searchCustomers,
  updateCustomer,
} from '../services/customersService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const includeInactive =
      req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    res.json(searchCustomers({ q: req.query.q, includeInactive }));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(getCustomerById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/purchases', (req, res, next) => {
  try {
    res.json(getCustomerPurchaseHistory(Number(req.params.id), { limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(createCustomer(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    res.json(updateCustomer(Number(req.params.id), req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/inactivate', (req, res, next) => {
  try {
    res.json(inactivateCustomer(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

export default router;
