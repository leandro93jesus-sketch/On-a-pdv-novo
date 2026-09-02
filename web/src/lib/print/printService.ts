/**
 * ÚNICO serviço de impressão do PDV.
 * Venda, reimpressão e teste usam esta mesma função.
 */

import type { PrinterSettings, Sale } from '../../api/client.ts';
import { createDesktopTransport } from './desktopTransport.ts';
import {
  buildEngineTestCupom,
  buildSaleCupom,
  type BuiltCupom,
  type CupomSaleInput,
  type CupomWidth,
} from './cupomBuilder.ts';
import { EMPTY_CUPOM_MESSAGE, validateCupomText } from './cupomValidate.ts';
import { cupomToPreviewHtml } from './previewHtml.ts';
import { createMockPrinter, type MockPrinter } from './mockPrinter.ts';
import { dispatchCupom, prepareCupomJob, type PrintMethod, type PrintTransport } from './printReceipt.ts';
import {
  formatPrinterList,
  PRINTER_NOT_FOUND_MESSAGE,
  resolveConfiguredPrinter,
  type ListedPrinter,
  type PrinterResolveResult,
} from './printerResolve.ts';
import { clearPrintTraces, formatPrintTraces, getPrintTraces, printLog, type PrintTraceEntry } from './printTrace.ts';

export const PRINT_SERVICE_NAME = 'PrintService.print';

export type PrintKind = 'sale' | 'reprint' | 'engine-test';

export interface PrintServiceResult {
  ok: boolean;
  error?: string;
  via?: string;
  sent?: boolean;
  kind: PrintKind;
  service: typeof PRINT_SERVICE_NAME;
  deviceName?: string;
  displayName?: string;
  deviceNameSource?: string;
  method?: PrintMethod;
  cupomText?: string;
  cupomHtml?: string;
  printers?: ListedPrinter[];
  resolve?: PrinterResolveResult;
  logs: PrintTraceEntry[];
  logText: string;
}

export interface PrintServiceDeps {
  fetchSettings: () => Promise<PrinterSettings | null>;
  listPrinters: () => Promise<ListedPrinter[]>;
  transport: PrintTransport | MockPrinter;
  persistPrinterFix?: (patch: Partial<PrinterSettings>) => Promise<void>;
}

export interface PrintSaleOpts {
  reprint?: boolean;
  company?: string;
  paperFormat?: string;
}

function thermalWidth(format?: string | null): CupomWidth {
  return format === '58mm' ? '58mm' : '80mm';
}

function saleSnapshot(sale: CupomSaleInput | Sale | null | undefined) {
  if (!sale) return { present: false };
  return {
    present: true,
    sale_number: sale.sale_number,
    items: (sale.items || []).length,
    payments: (sale.payments || []).length,
    total_cents: sale.total_cents,
    item_names: (sale.items || []).map((i) => i.name),
  };
}

export function createPrintService(deps: PrintServiceDeps) {
  async function print(
    kind: PrintKind,
    sale?: CupomSaleInput | Sale | null,
    opts: PrintSaleOpts = {}
  ): Promise<PrintServiceResult> {
    clearPrintTraces();
    printLog('FRONTEND: Solicitando impressão', { kind, service: PRINT_SERVICE_NAME });

    printLog('[1] Venda carregada', kind === 'engine-test' ? { kind, note: 'teste pelo motor do PDV' } : saleSnapshot(sale));

    if ((kind === 'sale' || kind === 'reprint') && !sale) {
      const error = EMPTY_CUPOM_MESSAGE;
      printLog('[2] Cupom gerado', { ok: false, error: 'venda ausente' });
      return fail(kind, error);
    }

    const settings = await deps.fetchSettings().catch(() => null);
    const printers = await deps.listPrinters().catch(() => []);
    const width = thermalWidth(opts.paperFormat || settings?.profile?.format);
    const method = ((settings?.method as PrintMethod) || 'escpos') as PrintMethod;
    const savedName = String(settings?.receipt_printer || '').trim();

    printLog('Impressora salva', savedName || '(nenhuma — usar padrão)');
    printLog('Impressoras disponíveis', formatPrinterList(printers));
    printers.forEach((p) => {
      printLog('Impressora detectada', {
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        isDefault: p.isDefault,
      });
    });

    const resolved = resolveConfiguredPrinter(settings, printers);
    printLog('Impressora escolhida', resolved.ok ? resolved.deviceName : '(inválida)');
    printLog('[4] Impressora selecionada', {
      ok: resolved.ok,
      deviceName: resolved.deviceName,
      source: resolved.source,
      savedName: resolved.savedName,
      use_windows_default: Boolean(settings?.use_windows_default),
    });
    if (!resolved.ok || !resolved.deviceName) {
      printLog('deviceName enviado', '(nenhum — recusado)');
      printLog('Resultado', 'erro');
      return fail(kind, resolved.error || PRINTER_NOT_FOUND_MESSAGE, {
        method,
        printers,
        resolve: resolved,
        deviceName: undefined,
        deviceNameSource: resolved.source,
      });
    }

    let cupom: BuiltCupom;
    if (kind === 'engine-test') {
      cupom = buildEngineTestCupom(width);
    } else {
      cupom = buildSaleCupom(sale as CupomSaleInput, {
        company: opts.company,
        width,
        reprint: kind === 'reprint' || opts.reprint,
      });
    }
    printLog('[2] Cupom gerado', {
      chars: cupom.text.length,
      lines: cupom.lineCount,
      width: cupom.width,
      text: cupom.text,
    });

    const valid = validateCupomText(cupom.text);
    printLog('[3] Conteúdo validado', { ok: valid.ok, chars: valid.ok ? valid.text.length : 0 });
    if (!valid.ok) {
      return fail(kind, valid.error, { cupomText: String(cupom.text || ''), method, printers, resolve: resolved });
    }

    try {
      const job = prepareCupomJob(cupom, {
        method,
        cut: settings?.cut !== false,
        printerName: resolved.deviceName,
        host: settings?.tcp_host,
        port: settings?.tcp_port,
        physicalTest: kind === 'engine-test',
      });
      if (!printers.some((p) => p.name === job.printerName)) {
        printLog('deviceName enviado', '(nenhum — recusado, nome não está na lista)');
        printLog('Resultado', 'erro');
        return fail(kind, PRINTER_NOT_FOUND_MESSAGE, {
          cupomText: valid.text,
          method,
          printers,
          resolve: resolved,
          deviceName: undefined,
        });
      }
      printLog('FRONTEND: Solicitando impressão', {
        ipc: 'printers:print-cupom',
        deviceName: job.printerName,
        method: job.method,
        bytes: job.bytes.length,
      });
      printLog('deviceName enviado', job.printerName);
      printLog('[5] Pedido de impressão enviado', {
        ipc: 'printers:print-cupom',
        deviceName: job.printerName,
        method: job.method,
        silent: true,
        printBackground: true,
      });
      const res = await dispatchCupom(job, deps.transport);
      printLog('Resultado', res.ok ? 'sucesso' : 'erro');
      printLog('[6] Retorno da impressão', {
        ok: res.ok,
        sent: res.sent,
        via: res.via,
        error: res.error || null,
      });
      return {
        ok: Boolean(res.ok),
        error: res.error,
        via: res.via,
        sent: res.sent,
        kind,
        service: PRINT_SERVICE_NAME,
        deviceName: resolved.deviceName,
        displayName: resolved.displayName,
        deviceNameSource: resolved.source,
        method,
        cupomText: valid.text,
        cupomHtml: cupomToPreviewHtml(valid.text, cupom.width),
        printers,
        resolve: resolved,
        logs: getPrintTraces(),
        logText: formatPrintTraces(),
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : EMPTY_CUPOM_MESSAGE;
      printLog('[6] Retorno da impressão', { ok: false, error });
      return fail(kind, error, {
        cupomText: valid.text,
        cupomHtml: cupomToPreviewHtml(valid.text, cupom.width),
        method,
        deviceName: resolved.deviceName,
        displayName: resolved.displayName,
        deviceNameSource: resolved.source,
        printers,
        resolve: resolved,
      });
    }
  }

  function fail(
    kind: PrintKind,
    error: string,
    extra: Partial<PrintServiceResult> = {}
  ): PrintServiceResult {
    return {
      ok: false,
      error,
      sent: false,
      kind,
      service: PRINT_SERVICE_NAME,
      logs: getPrintTraces(),
      logText: formatPrintTraces(),
      ...extra,
    };
  }

  return {
    name: PRINT_SERVICE_NAME,
    print,
    printSale(sale: CupomSaleInput | Sale, opts: PrintSaleOpts = {}) {
      return print(opts.reprint ? 'reprint' : 'sale', sale, opts);
    },
    printEngineTest(opts: PrintSaleOpts = {}) {
      return print('engine-test', null, opts);
    },
    previewSale(sale: CupomSaleInput | Sale, opts: PrintSaleOpts = {}) {
      const width = thermalWidth(opts.paperFormat);
      const cupom = buildSaleCupom(sale, {
        company: opts.company,
        width,
        reprint: opts.reprint,
      });
      const check = validateCupomText(cupom.text);
      if (!check.ok) return { ok: false as const, error: check.error };
      return { ok: true as const, cupom, html: cupomToPreviewHtml(cupom.text, cupom.width) };
    },
    previewEngineTest(width: CupomWidth = '80mm') {
      const cupom = buildEngineTestCupom(width);
      return { ok: true as const, cupom, html: cupomToPreviewHtml(cupom.text, cupom.width) };
    },
  };
}

export type PrintService = ReturnType<typeof createPrintService>;

let defaultService: PrintService | null = null;

export function getDefaultPrintService(): PrintService {
  if (!defaultService) {
    defaultService = createPrintService({
      fetchSettings: async () => {
        const { fetchPrinterSettings } = await import('../../api/client.ts');
        return fetchPrinterSettings().catch(() => null);
      },
      listPrinters: async () => {
        if (!window.oncaDesktop?.listPrinters) return [];
        const res = await window.oncaDesktop.listPrinters();
        return res.printers || [];
      },
      transport: createDesktopTransport(),
      persistPrinterFix: async (patch) => {
        const { updatePrinterSettingsApi } = await import('../../api/client.ts');
        await updatePrinterSettingsApi(patch);
      },
    });
  }
  return defaultService;
}

export function resetDefaultPrintService(): void {
  defaultService = null;
}

/** Atalho estável: venda e teste chamam isto. */
export function printViaService(
  kind: PrintKind,
  sale?: CupomSaleInput | Sale | null,
  opts?: PrintSaleOpts
): Promise<PrintServiceResult> {
  return getDefaultPrintService().print(kind, sale, opts);
}

export function createMockPrintService(
  opts: {
    settings?: Partial<PrinterSettings> | null;
    printers?: ListedPrinter[];
    mock?: MockPrinter;
  } = {}
) {
  const mock = opts.mock || createMockPrinter();
  const service = createPrintService({
    fetchSettings: async () =>
      ({
        use_windows_default: true,
        receipt_printer: '',
        reports_printer: '',
        default_printer: '',
        profile: { format: '80mm', copies: 1, auto_print: false, mode: 'manual' },
        method: 'escpos',
        cut: true,
        ...(opts.settings || {}),
      }) as PrinterSettings,
    listPrinters: async () => opts.printers || [],
    transport: mock,
  });
  return { service, mock };
}
