import { Router } from 'express';
import {
  getProductByBarcode,
  getProductById,
  searchProducts,
} from '../services/productsService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const products = searchProducts({
      q: req.query.q,
      barcode: req.query.barcode,
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get('/barcode/:code', (req, res, next) => {
  try {
    const product = getProductByBarcode(req.params.code);
    res.json(product);
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
    const product = getProductById(id);
    res.json(product);
  } catch (err) {
    next(err);
  }
});

export default router;
