import type { CupomWidth } from './cupomBuilder.ts';

/** HTML só do cupom — fundo branco, texto preto. Sem app, sem modal. */
export function cupomToPreviewHtml(text: string, width: CupomWidth = '80mm'): string {
  const page = width === '58mm' ? '58mm' : width === '80mm' ? '80mm' : '80mm';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Pré-visualização do cupom</title>
  <style>
    @page { size: ${page} auto; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
    }
    pre.cupom-preview {
      margin: 0;
      padding: 8px;
      font-family: "Courier New", ui-monospace, monospace;
      font-size: 12px;
      line-height: 1.25;
      white-space: pre-wrap;
      word-break: break-word;
      color: #000000;
      background: #ffffff;
      visibility: visible;
      opacity: 1;
    }
  </style>
</head>
<body>
  <pre class="cupom-preview">${escaped}</pre>
</body>
</html>`;
}
