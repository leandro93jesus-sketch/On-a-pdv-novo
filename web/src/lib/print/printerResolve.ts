/**
 * deviceName = SOMENTE printer.name exato do Electron.
 * Nunca displayName, descrição, apelido ou nome antigo.
 */

export const PRINTER_NOT_FOUND_MESSAGE =
  'A impressora configurada não foi encontrada. Selecione novamente a impressora.';

export interface ListedPrinter {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  description?: string;
}

export interface PrinterSettingsLike {
  use_windows_default?: boolean;
  receipt_printer?: string;
  default_printer?: string;
}

export interface PrinterResolveResult {
  ok: boolean;
  error?: string;
  deviceName: string | undefined;
  displayName?: string;
  listedName?: string;
  source: 'windows-default' | 'matched-name' | 'not-found' | 'no-default' | 'empty-list';
  savedName?: string;
  stale: boolean;
  corrected: boolean;
  printers: ListedPrinter[];
  comparison: Array<{
    name: string;
    displayName: string;
    isDefault: boolean;
    matchesSaved: boolean;
  }>;
}

/** Somente igualdade estrita com printer.name. */
export function findExactPrinterName(
  printers: ListedPrinter[],
  wanted?: string | null
): ListedPrinter | undefined {
  if (wanted == null) return undefined;
  return (printers || []).find((p) => p.name === wanted);
}

export function formatPrinterList(printers: ListedPrinter[]): string {
  if (!printers.length) return '(nenhuma)';
  return printers.map((p) => `- ${p.name}`).join('\n');
}

export function resolveConfiguredPrinter(
  settings: PrinterSettingsLike | null | undefined,
  printers: ListedPrinter[]
): PrinterResolveResult {
  const list = Array.isArray(printers) ? printers : [];
  const savedName = String(settings?.receipt_printer || '').trim();
  const useDefault = Boolean(settings?.use_windows_default) || !savedName;
  const comparison = list.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean(p.isDefault),
    matchesSaved: Boolean(savedName) && p.name === savedName,
  }));

  const empty = (extra: Partial<PrinterResolveResult>): PrinterResolveResult => ({
    ok: false,
    error: PRINTER_NOT_FOUND_MESSAGE,
    deviceName: undefined,
    savedName: savedName || undefined,
    stale: Boolean(savedName),
    corrected: false,
    printers: list,
    comparison,
    source: 'not-found',
    ...extra,
  });

  if (!list.length) {
    return empty({ source: 'empty-list' });
  }

  if (!useDefault) {
    const match = findExactPrinterName(list, savedName);
    if (!match) {
      return empty({ source: 'not-found', stale: true });
    }
    return {
      ok: true,
      deviceName: match.name,
      displayName: match.displayName || match.name,
      listedName: match.name,
      source: 'matched-name',
      savedName,
      stale: false,
      corrected: false,
      printers: list,
      comparison,
    };
  }

  const osDefault = list.find((p) => p.isDefault);
  if (!osDefault) {
    return empty({ source: 'no-default', stale: false });
  }
  return {
    ok: true,
    deviceName: osDefault.name,
    displayName: osDefault.displayName || osDefault.name,
    listedName: osDefault.name,
    source: 'windows-default',
    savedName: savedName || undefined,
    stale: false,
    corrected: false,
    printers: list,
    comparison,
  };
}
