import { getSetting, setSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';
import { AppError } from '../utils/errors.js';

const PRINTER_KEYS = [
  'printer_use_windows_default',
  'printer_receipt_name',
  'printer_reports_name',
  'printer_delivery_name',
  'printer_default_name',
  'print_profile_format',
  'print_profile_copies',
  'print_profile_auto',
  'print_profile_mode',
  'printer_per_device_json',
  'print_method',
  'print_cut',
  'print_tcp_host',
  'print_tcp_port',
];

const FORMATS = new Set(['A4', '80mm', '58mm']);
const MODES = new Set(['manual', 'auto']);
const METHODS = new Set(['windows', 'escpos', 'tcp']);

function parsePerPrinter() {
  try {
    const raw = getSetting('printer_per_device_json', '{}') || '{}';
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function getPrinterSettings() {
  return {
    use_windows_default: getSetting('printer_use_windows_default', '1') === '1',
    receipt_printer: getSetting('printer_receipt_name', ''),
    reports_printer: getSetting('printer_reports_name', ''),
    delivery_printer: getSetting('printer_delivery_name', ''),
    default_printer: getSetting('printer_default_name', ''),
    profile: {
      format: getSetting('print_profile_format', 'A4') || 'A4',
      copies: Math.max(1, Number(getSetting('print_profile_copies', '1') || 1)),
      auto_print: getSetting('print_profile_auto', '0') === '1',
      mode: getSetting('print_profile_mode', 'manual') || 'manual',
    },
    method: getSetting('print_method', 'escpos') || 'escpos',
    cut: getSetting('print_cut', '1') === '1',
    tcp_host: getSetting('print_tcp_host', ''),
    tcp_port: Number(getSetting('print_tcp_port', '9100') || 9100),
    per_printer: parsePerPrinter(),
    note:
      'A listagem de impressoras instaladas e o teste real de impressão dependem do aplicativo desktop (Windows/Linux).',
  };
}

export function updatePrinterSettings(payload = {}, userName) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Payload inválido', { status: 400, code: 'VALIDATION' });
  }

  const changed = [];
  const set = (key, value) => {
    const prev = getSetting(key, '');
    const next = String(value ?? '');
    if (prev !== next) {
      setSetting(key, next);
      changed.push(key);
    }
  };

  if (payload.use_windows_default != null) {
    set('printer_use_windows_default', payload.use_windows_default ? '1' : '0');
  }
  if (payload.receipt_printer != null) set('printer_receipt_name', payload.receipt_printer);
  if (payload.reports_printer != null) set('printer_reports_name', payload.reports_printer);
  if (payload.delivery_printer != null) set('printer_delivery_name', payload.delivery_printer);
  if (payload.default_printer != null) set('printer_default_name', payload.default_printer);
  if (payload.per_printer != null) {
    if (typeof payload.per_printer !== 'object') {
      throw new AppError('Perfis por impressora inválidos', { status: 400, code: 'INVALID_PER_PRINTER' });
    }
    set('printer_per_device_json', JSON.stringify(payload.per_printer));
  }

  const profile = payload.profile || {};
  if (profile.format != null) {
    const f = String(profile.format);
    if (!FORMATS.has(f)) {
      throw new AppError('Formato de impressão inválido', { status: 400, code: 'INVALID_PRINT_FORMAT' });
    }
    set('print_profile_format', f);
  }
  if (profile.copies != null) {
    const n = Number(profile.copies);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new AppError('Número de cópias inválido (1–10)', { status: 400, code: 'INVALID_COPIES' });
    }
    set('print_profile_copies', String(n));
  }
  if (profile.auto_print != null) {
    set('print_profile_auto', profile.auto_print ? '1' : '0');
  }
  if (profile.mode != null) {
    const m = String(profile.mode);
    if (!MODES.has(m)) {
      throw new AppError('Modo de impressão inválido', { status: 400, code: 'INVALID_PRINT_MODE' });
    }
    set('print_profile_mode', m);
  }
  if (payload.method != null) {
    const m = String(payload.method);
    if (!METHODS.has(m)) {
      throw new AppError('Método de impressão inválido', { status: 400, code: 'INVALID_PRINT_METHOD' });
    }
    set('print_method', m);
  }
  if (payload.cut != null) {
    set('print_cut', payload.cut ? '1' : '0');
  }
  if (payload.tcp_host != null) set('print_tcp_host', payload.tcp_host);
  if (payload.tcp_port != null) {
    const p = Number(payload.tcp_port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new AppError('Porta TCP inválida', { status: 400, code: 'INVALID_TCP_PORT' });
    }
    set('print_tcp_port', String(p));
  }

  if (changed.length) {
    writeAudit({
      action: 'settings.printers.update',
      entityType: 'settings',
      details: { changed },
      userName,
    });
  }
  return getPrinterSettings();
}

/** Resolve qual impressora usar para um tipo de documento. */
export function resolvePrinterFor(kind = 'receipt') {
  const cfg = getPrinterSettings();
  if (cfg.use_windows_default) {
    return { deviceName: undefined, useDefault: true, copies: cfg.profile.copies, format: cfg.profile.format };
  }
  let name = cfg.default_printer;
  if (kind === 'receipt' && cfg.receipt_printer) name = cfg.receipt_printer;
  if (kind === 'report' && cfg.reports_printer) name = cfg.reports_printer;
  if ((kind === 'delivery' || kind === 'pedido') && cfg.delivery_printer) name = cfg.delivery_printer;
  const per = name && cfg.per_printer ? cfg.per_printer[name] : null;
  const format = per?.format && FORMATS.has(per.format) ? per.format : cfg.profile.format;
  const copies = per?.copies != null ? Math.max(1, Number(per.copies) || 1) : cfg.profile.copies;
  return {
    deviceName: name || undefined,
    useDefault: !name,
    copies,
    format,
    auto_print: cfg.profile.auto_print,
    mode: cfg.profile.mode,
    method: cfg.method,
    cut: cfg.cut,
    tcp_host: cfg.tcp_host,
    tcp_port: cfg.tcp_port,
  };
}

/** Remove apenas preferências de impressão (não toca produtos/vendas/caixa). */
export function resetPrinterSettings(userName) {
  for (const key of PRINTER_KEYS) {
    const def =
      key === 'printer_use_windows_default'
        ? '1'
        : key === 'print_profile_format'
          ? 'A4'
          : key === 'print_profile_copies'
            ? '1'
            : key === 'print_profile_auto'
              ? '0'
              : key === 'print_profile_mode'
                ? 'manual'
                : key === 'printer_per_device_json'
                  ? '{}'
                  : key === 'print_method'
                    ? 'escpos'
                    : key === 'print_cut'
                      ? '1'
                      : key === 'print_tcp_port'
                        ? '9100'
                        : '';
    setSetting(key, def);
  }
  writeAudit({
    action: 'settings.printers.reset',
    entityType: 'settings',
    details: { keys: PRINTER_KEYS },
    userName,
  });
  return getPrinterSettings();
}

export { PRINTER_KEYS };
