import { getAuthToken } from '../api/client';

/**
 * Salva PDF no computador via diálogo nativo (Electron)
 * ou fallback de download no navegador.
 * NÃO altera venda/estoque/caixa — só exporta o arquivo.
 */
export async function savePdfToComputer(opts: {
  suggestedName: string;
  downloadUrl: string;
  absolutePath?: string | null;
  title?: string;
}): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; mode: 'desktop' | 'browser'; error?: string }> {
  const suggestedName = sanitizeFilename(opts.suggestedName || 'ONCA-DOCUMENTO.pdf');
  const desktop = window.oncaDesktop;

  if (desktop?.isDesktop && typeof desktop.savePdf === 'function') {
    try {
      // Preferir URL absoluta da API local para o main process buscar o PDF.
      const url = toAbsoluteUrl(opts.downloadUrl);
      const result = await desktop.savePdf({
        title: opts.title || 'Salvar PDF',
        defaultPath: suggestedName,
        suggestedName,
        absolutePath: opts.absolutePath || undefined,
        url,
      });
      if (result.canceled) return { ok: false, canceled: true, mode: 'desktop' };
      if (!result.ok) {
        return { ok: false, mode: 'desktop', error: result.error || 'Falha ao salvar PDF' };
      }
      return { ok: true, filePath: result.filePath, mode: 'desktop' };
    } catch (e) {
      return {
        ok: false,
        mode: 'desktop',
        error: e instanceof Error ? e.message : 'Falha no diálogo Salvar PDF',
      };
    }
  }

  // Fallback navegador: dispara download com nome sugerido
  try {
    const token = getAuthToken();
    const res = await fetch(opts.downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = suggestedName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    return { ok: true, mode: 'browser' };
  } catch (e) {
    return {
      ok: false,
      mode: 'browser',
      error: e instanceof Error ? e.message : 'Falha ao baixar PDF',
    };
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = String(name || 'ONCA-DOCUMENTO.pdf')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }
  return pathOrUrl;
}
