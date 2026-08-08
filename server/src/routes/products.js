import { Router } from 'express';
import {
  createProduct,
  deleteOrInactivateProduct,
  getProductByBarcode,
  getProductById,
  listProductPriceHistory,
  searchProducts,
  updateProduct,
} from '../services/productsService.js';
import {
  findDuplicateCandidates,
  updateDuplicateReview,
  previewMerge,
  mergeProducts,
} from '../services/duplicateProductsService.js';
import { getProductStockHistory } from '../services/stockService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const includeInactive =
      req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const products = searchProducts({
      q: req.query.q,
      barcode: req.query.barcode,
      category: req.query.category,
      includeInactive,
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get('/duplicates', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const includeInactive =
      req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    res.json(findDuplicateCandidates({ includeInactive }));
  } catch (err) {
    next(err);
  }
});

router.post('/duplicates/review', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(
      updateDuplicateReview({
        ...req.body,
        userName: req.user?.name,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/merge/preview', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(previewMerge(req.query.primary_id, req.query.secondary_id));
  } catch (err) {
    next(err);
  }
});

router.post('/merge', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const result = mergeProducts({
      ...req.body,
      userName: req.user?.name,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/barcode/:code', (req, res, next) => {
  try {
    res.json(getProductByBarcode(req.params.code));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/history', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(getProductStockHistory(id, { limit: req.query.limit }));
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
    res.json(getProductById(id));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const product = createProduct(req.body ?? {});
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/price-history', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(listProductPriceHistory(id, { limit: req.query.limit }));
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
    const body = req.body ?? {};
    if (
      process.env.NODE_ENV !== 'test' &&
      body.price_cents != null &&
      req.user &&
      req.user.role !== 'administrador'
    ) {
      throw new AppError('Alteração de preço exige administrador', {
        status: 403,
        code: 'FORBIDDEN_PRICE_CHANGE',
      });
    }
    res.json(updateProduct(id, body));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(deleteOrInactivateProduct(id));
  } catch (err) {
    next(err);
  }
});

export default router;
