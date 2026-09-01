import { Router } from 'express';
import { requireAuth, authOptional } from '../middleware/auth.js';
import {
  listDeliveryOrders,
  getDeliveryOrder,
  createDeliveryOrder,
  updateDeliveryOrder,
  updateDeliveryOrderAddress,
  logDeliveryOrderRouteEvent,
  confirmDeliveryOrderPayment,
  cancelDeliveryOrder,
  updateDeliveryOrderStatus,
  getProductAvailability,
  scanDeliveryOrderBarcode,
  confirmDeliveryOrderItemManual,
} from '../services/deliveryOrdersService.js';
import { buildDeliveryOrderWhatsAppShare } from '../services/whatsappService.js';

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

router.put('/:id', requireAuth, (req, res, next) => {
  try {
    res.json(updateDeliveryOrder(req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/address', requireAuth, (req, res, next) => {
  try {
    res.json(updateDeliveryOrderAddress(req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/route-event', requireAuth, (req, res, next) => {
  try {
    res.json(
      logDeliveryOrderRouteEvent(req.params.id, {
        event: req.body?.event,
        note: req.body?.note,
        phone: req.body?.phone,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/:id/whatsapp', requireAuth, (req, res, next) => {
  try {
    const order = getDeliveryOrder(req.params.id);
    const share = buildDeliveryOrderWhatsAppShare({
      order,
      phone: req.body?.phone,
      message: req.body?.message,
      recipient: req.body?.recipient,
    });
    // Histórico: compartilhamento (sem impacto financeiro)
    logDeliveryOrderRouteEvent(order.id, {
      event: 'route_shared',
      phone: share.phone,
      note: req.body?.recipient ? `para ${req.body.recipient}` : null,
    });
    res.json({ ...share, order: getDeliveryOrder(order.id) });
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
