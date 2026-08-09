import { Router } from 'express';
import { requireAuth, authOptional } from '../middleware/auth.js';
import {
  listDeliveryOrders,
  getDeliveryOrder,
  createDeliveryOrder,
  confirmDeliveryOrderPayment,
  cancelDeliveryOrder,
  updateDeliveryOrderStatus,
  getProductAvailability,
  scanDeliveryOrderBarcode,
  confirmDeliveryOrderItemManual,
} from '../services/deliveryOrdersService.js';

const router = Router();

router.get('/', authOptional, (req, res, next) => {
  try {
    res.json(
      listDeliveryOrders({
        status: req.query.status,
        payment_status: req.query.payment_status,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, (req, res, next) => {
  try {
    res.status(201).json(createDeliveryOrder(req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.get('/availability/:productId', authOptional, (req, res, next) => {
  try {
    res.json(getProductAvailability(req.params.productId));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authOptional, (req, res, next) => {
  try {
    res.json(getDeliveryOrder(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/payments', requireAuth, (req, res, next) => {
  try {
    res.json(confirmDeliveryOrderPayment(req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireAuth, (req, res, next) => {
  try {
    res.json(cancelDeliveryOrder(req.params.id, { reason: req.body?.reason }));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', requireAuth, (req, res, next) => {
  try {
    res.json(
      updateDeliveryOrderStatus(req.params.id, req.body?.status, req.body?.note, {
        allowUnchecked: Boolean(req.body?.allow_unchecked),
        userRole: req.user?.role,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/:id/scan', requireAuth, (req, res, next) => {
  try {
    res.json(scanDeliveryOrderBarcode(req.params.id, req.body?.barcode ?? req.body?.code));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId/confirm-manual', requireAuth, (req, res, next) => {
  try {
    res.json(
      confirmDeliveryOrderItemManual(req.params.id, req.params.itemId, {
        quantity: req.body?.quantity,
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
