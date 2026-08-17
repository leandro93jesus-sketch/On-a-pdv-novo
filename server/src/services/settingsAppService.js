import { getDb } from '../db/index.js';
import { getSetting, setSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';
import { AppError } from '../utils/errors.js';
import { getLogoMeta } from './logoService.js';
import { getPrinterSettings } from './printerSettingsService.js';

const COMPANY_KEYS = [
  'store_name',
  'store_trade_name',
  'store_document',
  'store_address',
  'store_phone',
  'store_whatsapp',
  'store_site',
  'store_instagram',
  'receipt_message',
];

const PDV_KEYS = [
  'ui_theme',
  'ui_scale',
  'cash_require_open',
  'sale_allow_misc',
  'print_auto_open',
  'allow_negative_stock_global',
  'backup_dir',
  'whatsapp_default_message',
  'terminal_id',
  'current_operator',
  'currency',
  'app_version',
];

const ALL_KEYS = [...COMPANY_KEYS, ...PDV_KEYS];

export function getSettingsBundle() {
  const company = {};
  const pdv = {};
  for (const k of COMPANY_KEYS) company[k] = getSetting(k, '');
  for (const k of PDV_KEYS) pdv[k] = getSetting(k, '');
  return {
    company,
    pdv,
    logo: getLogoMeta(),
    printers: getPrinterSettings(),
    app_version: getSetting('app_version', '1.0.0'),
  };
}

export function updateSettings(patch, userName) {
  if (!patch || typeof patch !== 'object') {
    throw new AppError('Payload inválido', { code: 'VALIDATION' });
  }
  const flat = { ...(patch.company || {}), ...(patch.pdv || {}), ...patch };
  const changed = [];
  for (const [key, value] of Object.entries(flat)) {
    if (!ALL_KEYS.includes(key)) continue;
    if (key === 'app_version') continue; // não editável pela UI
    const prev = getSetting(key, '');
    if (String(prev) !== String(value ?? '')) {
      setSetting(key, value ?? '');
      changed.push(key);
    }
  }
  if (changed.length) {
    writeAudit({
      action: 'settings.update',
      entityType: 'settings',
      details: { changed },
      userName,
    });
  }
  return getSettingsBundle();
}

export function getCompanyForReceipt() {
  const logo = getLogoMeta();
  return {
    store_name: getSetting('store_name', 'ONÇA PDV'),
    store_trade_name: getSetting('store_trade_name', 'ONÇA PRODUTOS DE LIMPEZA'),
    store_document: getSetting('store_document', ''),
    store_address: getSetting('store_address', ''),
    store_phone: getSetting('store_phone', ''),
    store_whatsapp: getSetting('store_whatsapp', ''),
    store_site: getSetting('store_site', 'www.oncalimpeza.com.br'),
    store_instagram: getSetting('store_instagram', '@onca_limpeza'),
    receipt_message: getSetting('receipt_message', 'Obrigado pela preferência!'),
    logo,
  };
}

export function listAllSettingsRaw() {
  return getDb().prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
}
