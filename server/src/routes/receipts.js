import { Router } from 'express';
import { buildSaleReceiptPdf } from '../services/pdfService.js';
import { buildWhatsAppShare } from '../services/whatsappService.js';
import { authOptional } from '../middleware/auth.js';

const router = Router();

router.get('/sales/:id/pdf', authOptional, async (req, res, next) => {
  try {
    const pdf = await buildSaleReceiptPdf(Number(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprovante-venda-${req.params.id}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/sales/:id/whatsapp', authOptional, (req, res, next) => {
  try {
    const share = buildWhatsAppShare({
      saleId: Number(req.params.id),
      phone: req.body?.phone,
      message: req.body?.message,
    });
    res.json(share);
  } catch (err) {
    next(err);
  }
});

export default router;
