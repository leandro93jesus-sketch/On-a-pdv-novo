import { getSetting, setSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';
import { AppError } from '../utils/errors.js';

const PRINTER_KEYS = [
  'printer_use_windows_default',
  'printer_receipt_name',
  'printer_reports_name',
  'printer_default_name',
  'print_profile_format',
  'print_profile_copies',
  'print_profile_auto',
  'print_profile_mode',
];

const FORMATS = new Set(['A4', '80mm', '58mm']);
const MODES = new Set(['manual', 'auto']);

export function getPrinterSettings() {
  return {
    use_windows_default: getSetting('printer_use_windows_default', '1') === '1',
    receipt_printer: getSetting('printer_receipt_name', ''),
    reports_printer: getSetting('printer_reports_name', ''),
    default_printer: getSetting('printer_default_name', ''),
    profile: {
      format: getSetting('print_profile_format', 'A4') || 'A4',
      copies: Math.max(1, Number(getSetting('print_profile_copies', '1') || 1)),
      auto_print: getSetting('print_profile_auto', '0') === '1',
      mode: getSetting('print_profile_mode', 'manual') || 'manual',
    },
    note:
      'A listagem de impressoras instaladas e o teste real de impressão dependem do aplicativo desktop Windows.',
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
  if (payload.default_printer != null) set('printer_default_name', payload.default_printer);

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
  return {
    deviceName: name || undefined,
    useDefault: !name,
    copies: cfg.profile.copies,
    format: cfg.profile.format,
    auto_print: cfg.profile.auto_print,
    mode: cfg.profile.mode,
  };
}

export { PRINTER_KEYS };
