import PDFDocument from 'pdfkit';
import { getCashConference } from './cashService.js';
import { getCompanyForReceipt } from './settingsAppService.js';

/**
 * PDF do fechamento de caixa (conferência do dia).
 * Somente leitura: usa getCashConference e não altera caixa, venda ou estoque.
 */

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function buildCashClosingFilename(sessionId) {
  return `onca-pdv-fechamento-caixa-${String(sessionId).padStart(4, '0')}.pdf`;
}

export async function buildCashClosingPdf(sessionId) {
  const { session, breakdown, expected_amount_cents: expected } = getCashConference(sessionId);
  const company = getCompanyForReceipt();
  const contado = session.counted_amount_cents;
  const diferenca = contado == null ? null : contado - expected;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 48;
    const right = doc.page.width - 48;

    const titulo = (texto) => {
      doc.moveDown(0.6);
      doc.fontSize(11).fillColor('#0f3d2e').text(texto, left);
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor('#d0d9e3').stroke();
      doc.moveDown(0.4);
    };
    const linha = (rotulo, valor, { forte = false, sinal = '' } = {}) => {
      const y = doc.y;
      doc.fontSize(forte ? 11 : 10).fillColor(forte ? '#0f3d2e' : '#1a2433');
      doc.text(rotulo, left, y, { width: 300 });
      doc.text(`${sinal}${valor}`, left + 300, y, { width: right - left - 300, align: 'right' });
      doc.moveDown(0.35);
    };

    doc.fontSize(15).fillColor('#0f3d2e');
    doc.text(company.store_trade_name || company.store_name || 'ONÇA PRODUTOS DE LIMPEZA', {
      align: 'center',
    });
    doc.fontSize(12).fillColor('#1a2433').text('FECHAMENTO DE CAIXA', { align: 'center' });
    doc.fontSize(9).fillColor('#5b6b7c').text('Documento não fiscal', { align: 'center' });
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor('#1a2433');
    linha('Caixa', `#${session.id}`);
    linha('Operador', session.operator_name || '—');
    linha('Abertura', session.opened_at || '—');
    linha('Fechamento', session.closed_at || 'em aberto');
    linha('Situação', session.status === 'closed' ? 'FECHADO' : 'ABERTO');

    titulo('VENDAS DO PERÍODO (conferência por forma de pagamento)');
    linha('Dinheiro', brl(breakdown.sales_dinheiro_cents));
    linha('Pix', brl(breakdown.sales_pix_cents));
    linha('Cartão débito', brl(breakdown.sales_cartao_debito_cents));
    linha('Cartão crédito', brl(breakdown.sales_cartao_credito_cents));
    if (breakdown.sales_cartao_legado_cents) {
      linha('Cartão (sem tipo registrado)', brl(breakdown.sales_cartao_legado_cents));
    }
    linha('Crediário', brl(breakdown.sales_crediario_cents));
    linha('Outras formas', brl(breakdown.sales_outras_cents));
    linha('TOTAL VENDIDO', brl(breakdown.sales_total_cents), { forte: true });

    titulo('MOVIMENTAÇÕES DO CAIXA (dinheiro em gaveta)');
    linha('Fundo / saldo inicial', brl(breakdown.opening_amount_cents));
    linha('Dinheiro de vendas', brl(breakdown.sales_dinheiro_cents), { sinal: '+ ' });
    linha('Suprimentos', brl(breakdown.suprimentos_cents), { sinal: '+ ' });
    linha('Sangrias', brl(breakdown.sangrias_cents), { sinal: '- ' });
    linha('Cancelamentos em dinheiro (já descontados das vendas)', brl(breakdown.cancelamentos_dinheiro_cents), {
      sinal: '- ',
    });

    titulo('CONFERÊNCIA DA GAVETA');
    linha('VALOR ESPERADO EM DINHEIRO', brl(expected), { forte: true });
    linha('DINHEIRO CONTADO', contado == null ? 'não informado' : brl(contado), { forte: true });
    if (diferenca != null) {
      const rotulo =
        diferenca === 0 ? 'CAIXA CORRETO' : diferenca > 0 ? 'SOBRA' : 'FALTA';
      doc.moveDown(0.2);
      doc
        .fontSize(13)
        .fillColor(diferenca === 0 ? '#0f3d2e' : '#b42318')
        .text(`${rotulo}${diferenca === 0 ? '' : ` ${brl(Math.abs(diferenca))}`}`, left);
      doc.moveDown(0.3);
    }
    doc.fontSize(9).fillColor('#5b6b7c');
    doc.text(
      'Pix, cartões e crediário aparecem apenas para conferência do faturamento: não entram no dinheiro físico esperado na gaveta.',
      left,
      doc.y,
      { width: right - left }
    );

    titulo('RESUMO FINAL');
    doc.fontSize(10).fillColor('#1a2433');
    linha('Quantidade de vendas', String(breakdown.sales_count));
    linha('Itens vendidos', String(breakdown.items_sold));
    linha('Faturamento bruto', brl(breakdown.gross_cents));
    linha('Descontos', brl(breakdown.discount_cents));
    linha('Faturamento líquido', brl(breakdown.net_cents));
    linha('Dinheiro', brl(breakdown.sales_dinheiro_cents));
    linha('Pix', brl(breakdown.sales_pix_cents));
    linha('Débito', brl(breakdown.sales_cartao_debito_cents));
    linha('Crédito', brl(breakdown.sales_cartao_credito_cents));
    linha('Crediário', brl(breakdown.sales_crediario_cents));
    linha('Suprimentos', brl(breakdown.suprimentos_cents));
    linha('Sangrias', brl(breakdown.sangrias_cents));
    linha('Valor esperado', brl(expected));
    linha('Valor contado', contado == null ? 'não informado' : brl(contado));
    linha('Diferença', diferenca == null ? 'não calculada' : brl(diferenca));

    if (session.close_notes) {
      titulo('OBSERVAÇÃO');
      doc.fontSize(10).fillColor('#1a2433').text(String(session.close_notes), left, doc.y, {
        width: right - left,
      });
    }

    doc.moveDown(1);
    doc
      .fontSize(8)
      .fillColor('#5b6b7c')
      .text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, left, doc.y);

    doc.end();
  });
}
