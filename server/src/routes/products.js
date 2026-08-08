import { Router } from 'express';
import {
  createProduct,
  deleteOrInactivateProduct,
  getProductByBarcode,
  getProductById,
  searchProducts,
  updateProduct,
} from '../services/productsService.js';

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

router.get('/barcode/:code', (req, res, next) => {
  try {
    res.json(getProductByBarcode(req.params.code));
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

router.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }
    res.json(updateProduct(id, req.body ?? {}));
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
