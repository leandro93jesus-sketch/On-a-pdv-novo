import { Router } from 'express';
import { listAuditLogs } from '../services/auditService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(
      listAuditLogs({
        limit: req.query.limit,
        offset: req.query.offset,
        action: req.query.action,
        userName: req.query.user_name,
        from: req.query.from,
        to: req.query.to,
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
