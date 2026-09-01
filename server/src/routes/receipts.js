import { Router } from 'express';
import {
  ensureSaleReceiptPdfFile,
  ensureDeliveryOrderPdfFile,
  ensureQuotePdfFile,
  ensureCreditAccountPdfFile,
} from '../services/pdfService.js';
import {
  buildWhatsAppShare,
  buildDeliveryOrderDocumentWhatsAppShare,
  buildQuoteWhatsAppShare,
} from '../services/whatsappService.js';
import { authOptional } from '../middleware/auth.js';

const router = Router();

function pdfMetaJson(saved, urls) {
  return {
    filename: saved.filename,
    relative_path: saved.relativePath,
    absolute_path: saved.absolutePath,
    folder_path: saved.dir,
    regenerated: saved.regenerated,
    ...urls,
  };
}

router.get('/sales/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = req.query.regen === '1' || req.query.force === '1';
    const saved = await ensureSaleReceiptPdfFile(Number(req.params.id), { force });
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${saved.filename}"`);
    res.setHeader('X-Onca-Pdf-Path', saved.relativePath);
    res.setHeader('X-Onca-Pdf-Filename', saved.filename);
    res.send(saved.buffer);
  } catch (err) {
    next(err);
  }
});

/** Metadados do PDF (gera/regenera sem impacto financeiro). */
router.post('/sales/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureSaleReceiptPdfFile(Number(req.params.id), { force });
    res.json({
      sale_id: saved.sale_id,
      sale_number: saved.sale_number,
      filename: saved.filename,
      relative_path: saved.relativePath,
      absolute_path: saved.absolutePath,
      folder_path: saved.dir,
      regenerated: saved.regenerated,
      download_url: `/api/receipts/sales/${saved.sale_id}/pdf?download=1`,
      view_url: `/api/receipts/sales/${saved.sale_id}/pdf`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sales/:id/whatsapp', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureSaleReceiptPdfFile(Number(req.params.id), { force });
    const share = buildWhatsAppShare({
      saleId: Number(req.params.id),
      phone: req.body?.phone,
      message: req.body?.message,
      pdfMeta: saved,
    });
    res.json({
      ...share,
      pdf: {
        filename: saved.filename,
        relative_path: saved.relativePath,
        absolute_path: saved.absolutePath,
        folder_path: saved.dir,
        download_url: `/api/receipts/sales/${saved.sale_id}/pdf?download=1`,
        view_url: `/api/receipts/sales/${saved.sale_id}/pdf`,
        regenerated: saved.regenerated,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/delivery-orders/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = req.query.regen === '1' || req.query.force === '1';
    const saved = await ensureDeliveryOrderPdfFile(Number(req.params.id), { force });
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${saved.filename}"`);
    res.setHeader('X-Onca-Pdf-Path', saved.relativePath);
    res.send(saved.buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/delivery-orders/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureDeliveryOrderPdfFile(Number(req.params.id), { force });
    res.json({
      order_id: saved.order_id,
      order_number: saved.order_number,
      pending: saved.pending,
      filename: saved.filename,
      relative_path: saved.relativePath,
      absolute_path: saved.absolutePath,
      folder_path: saved.dir,
      regenerated: saved.regenerated,
      download_url: `/api/receipts/delivery-orders/${req.params.id}/pdf?download=1`,
      view_url: `/api/receipts/delivery-orders/${req.params.id}/pdf`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/delivery-orders/:id/whatsapp', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureDeliveryOrderPdfFile(Number(req.params.id), { force });
    const share = buildDeliveryOrderDocumentWhatsAppShare({
      orderId: Number(req.params.id),
      phone: req.body?.phone,
      message: req.body?.message,
      pdfMeta: saved,
    });
    res.json({
      ...share,
      pdf: {
        filename: saved.filename,
        relative_path: saved.relativePath,
        absolute_path: saved.absolutePath,
        folder_path: saved.dir,
        download_url: `/api/receipts/delivery-orders/${req.params.id}/pdf?download=1`,
        view_url: `/api/receipts/delivery-orders/${req.params.id}/pdf`,
        regenerated: saved.regenerated,
        pending: saved.pending,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/quotes/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = req.query.regen === '1' || req.query.force === '1';
    const saved = await ensureQuotePdfFile(Number(req.params.id), { force });
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${saved.filename}"`);
    res.send(saved.buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/quotes/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureQuotePdfFile(Number(req.params.id), { force });
    res.json(
      pdfMetaJson(saved, {
        quote_id: saved.quote_id,
        quote_number: saved.quote_number,
        download_url: `/api/receipts/quotes/${saved.quote_id}/pdf?download=1`,
        view_url: `/api/receipts/quotes/${saved.quote_id}/pdf`,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/quotes/:id/whatsapp', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureQuotePdfFile(Number(req.params.id), { force });
    const share = buildQuoteWhatsAppShare({
      quoteId: Number(req.params.id),
      phone: req.body?.phone,
      message: req.body?.message,
      pdfMeta: saved,
    });
    res.json({
      ...share,
      pdf: pdfMetaJson(saved, {
        quote_id: saved.quote_id,
        quote_number: saved.quote_number,
        download_url: `/api/receipts/quotes/${saved.quote_id}/pdf?download=1`,
        view_url: `/api/receipts/quotes/${saved.quote_id}/pdf`,
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/credit-accounts/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = req.query.regen === '1' || req.query.force === '1';
    const saved = await ensureCreditAccountPdfFile(Number(req.params.id), { force });
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${saved.filename}"`);
    res.send(saved.buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/credit-accounts/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force || req.body?.regen);
    const saved = await ensureCreditAccountPdfFile(Number(req.params.id), { force });
    res.json(
      pdfMetaJson(saved, {
        credit_account_id: saved.credit_account_id,
        download_url: `/api/receipts/credit-accounts/${saved.credit_account_id}/pdf?download=1`,
        view_url: `/api/receipts/credit-accounts/${saved.credit_account_id}/pdf`,
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
