import { Router } from 'express';
import {
  createDelivery,
  getDeliveryById,
  listDeliveries,
  updateDelivery,
  updateDeliveryStatus,
} from '../services/deliveriesService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(
      listDeliveries({
        status: req.query.status,
        customerId: req.query.customer_id,
        courier: req.query.courier,
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(getDeliveryById(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(createDelivery(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    res.json(updateDelivery(Number(req.params.id), req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/status', (req, res, next) => {
  try {
    res.json(updateDeliveryStatus(Number(req.params.id), req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

export default router;
