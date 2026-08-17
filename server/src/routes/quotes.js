import { Router } from 'express';
import {
  createQuote,
  updateQuote,
  getQuoteById,
  listQuotes,
  cancelQuote,
  markQuoteConverted,
  getQuoteConversionPayload,
} from '../services/quotesService.js';
import { AppError } from '../utils/errors.js';
import { authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/', authOptional, (req, res, next) => {
  try {
    const result = listQuotes({
      status: req.query.status,
      quote_number: req.query.quote_number || req.query.number,
      customer: req.query.customer,
      phone: req.query.phone,
      from: req.query.from,
      to: req.query.to,
      term: req.query.q || req.query.term,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authOptional, (req, res, next) => {
  try {
    const quote = getQuoteById(Number(req.params.id));
    if (!quote) throw new AppError('Orçamento não encontrado', { status: 404, code: 'NOT_FOUND' });
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.post('/', authOptional, (req, res, next) => {
  try {
    const quote = createQuote(req.body || {});
    res.status(201).json(quote);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authOptional, (req, res, next) => {
  try {
    const quote = updateQuote(Number(req.params.id), req.body || {});
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', authOptional, (req, res, next) => {
  try {
    const quote = cancelQuote(Number(req.params.id), req.body || {});
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/conversion-payload', authOptional, (req, res, next) => {
  try {
    res.json(getQuoteConversionPayload(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/mark-converted', authOptional, (req, res, next) => {
  try {
    const saleId = Number(req.body?.sale_id);
    if (!saleId) {
      throw new AppError('sale_id obrigatório', { status: 400, code: 'SALE_ID_REQUIRED' });
    }
    const quote = markQuoteConverted(Number(req.params.id), saleId);
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

export default router;
