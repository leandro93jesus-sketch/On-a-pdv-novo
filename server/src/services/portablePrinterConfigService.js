import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../db/paths.js';
import { getPrinterSettings, updatePrinterSettings } from './printerSettingsService.js';
import { AppError } from '../utils/errors.js';

function configDir() {
  const dir = join(getDataDir(), 'configuracoes');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function portablePrinterConfigPath() {
  return join(configDir(), 'impressoras.json');
}

export function buildPortablePrinterConfig() {
  const settings = getPrinterSettings();
  return {
    schema: 'onca-pdv-impressoras/v1',
    exported_at: new Date().toISOString(),
    app: 'ONÇA PDV',
    printers: {
      use_windows_default: settings.use_windows_default,
      receipt_printer: settings.receipt_printer,
      reports_printer: settings.reports_printer,
      delivery_printer: settings.delivery_printer || '',
      default_printer: settings.default_printer,
      profile: settings.profile,
      per_printer: settings.per_printer || {},
    },
    note:
      'O pareamento Bluetooth pertence ao sistema operacional e pode precisar ser refeito em outro computador. Papel e perfil são preservados.',
  };
}

export function savePortablePrinterConfigFile() {
  const cfg = buildPortablePrinterConfig();
  const path = portablePrinterConfigPath();
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
  return { path, config: cfg };
}

export function exportPortablePrinterConfig() {
  const saved = savePortablePrinterConfigFile();
  return saved.config;
}

export function importPortablePrinterConfig(payload = {}, userName) {
  const root = payload.printers || payload;
  if (!root || typeof root !== 'object') {
    throw new AppError('Arquivo de configuração inválido', { status: 400, code: 'INVALID_PRINTER_CONFIG' });
  }
  const updated = updatePrinterSettings(
    {
      use_windows_default: root.use_windows_default,
      receipt_printer: root.receipt_printer,
      reports_printer: root.reports_printer,
      delivery_printer: root.delivery_printer,
      default_printer: root.default_printer,
      profile: root.profile,
      per_printer: root.per_printer,
    },
    userName
  );
  savePortablePrinterConfigFile();
  return {
    settings: updated,
    note:
      'Configuração importada. Se a impressora não existir neste computador, selecione uma equivalente mantendo o papel/perfil.',
  };
}

export function loadPortablePrinterConfigIfPresent() {
  const path = portablePrinterConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Verifica se nomes salvos existem na lista atual do SO. */
export function matchPrintersOnHost(osPrinterNames = []) {
  const cfg = getPrinterSettings();
  const names = new Set((osPrinterNames || []).map((n) => String(n).toLowerCase()));
  const check = (name) => {
    if (!name) return { configured: '', found: true };
    return { configured: name, found: names.has(String(name).toLowerCase()) };
  };
  return {
    receipt: check(cfg.receipt_printer),
    reports: check(cfg.reports_printer),
    delivery: check(cfg.delivery_printer || ''),
    default: check(cfg.default_printer),
  };
}
