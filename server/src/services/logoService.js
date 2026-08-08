import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { getAssetsDir, ensureDataDir } from '../db/paths.js';
import { getSetting, setSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';
import { AppError } from '../utils/errors.js';

const ALLOWED = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function logoDir() {
  ensureDataDir();
  const dir = join(getAssetsDir(), 'brand');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogoMeta() {
  const filename = getSetting('store_logo_filename', '');
  const mime = getSetting('store_logo_mime', '');
  if (!filename) {
    return { has_logo: false, filename: null, mime: null, url: null };
  }
  const path = join(logoDir(), filename);
  if (!existsSync(path)) {
    return { has_logo: false, filename: null, mime: null, url: null };
  }
  return {
    has_logo: true,
    filename,
    mime: mime || ALLOWED.get(extname(filename).toLowerCase()) || 'image/png',
    url: '/api/settings/logo',
    path,
  };
}

export function readLogoBuffer() {
  const meta = getLogoMeta();
  if (!meta.has_logo || !meta.path) return null;
  return {
    buffer: readFileSync(meta.path),
    mime: meta.mime,
    filename: meta.filename,
  };
}

export function saveLogoFromBase64({ filename, content_base64, userName } = {}) {
  if (!content_base64) {
    throw new AppError('Arquivo do logo é obrigatório', { status: 400, code: 'LOGO_REQUIRED' });
  }
  const original = String(filename || 'logo.png');
  const ext = extname(original).toLowerCase() || '.png';
  if (!ALLOWED.has(ext)) {
    throw new AppError('Formato inválido. Use PNG, JPG, JPEG ou WEBP.', {
      status: 400,
      code: 'LOGO_INVALID_TYPE',
    });
  }
  let buffer;
  try {
    buffer = Buffer.from(content_base64, 'base64');
  } catch {
    throw new AppError('Logo inválido (base64)', { status: 400, code: 'LOGO_INVALID' });
  }
  if (!buffer.length) {
    throw new AppError('Arquivo do logo vazio', { status: 400, code: 'LOGO_EMPTY' });
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new AppError('Logo muito grande (máx. 5MB)', { status: 400, code: 'LOGO_TOO_LARGE' });
  }

  clearLogoFiles();
  const safeName = `store-logo${ext}`;
  const path = join(logoDir(), safeName);
  writeFileSync(path, buffer);
  setSetting('store_logo_filename', safeName);
  setSetting('store_logo_mime', ALLOWED.get(ext));
  writeAudit({
    action: 'settings.logo.save',
    entityType: 'settings',
    details: { filename: safeName, bytes: buffer.length },
    userName,
  });
  return getLogoMeta();
}

function clearLogoFiles() {
  const dir = logoDir();
  for (const f of readdirSync(dir)) {
    if (f.startsWith('store-logo')) {
      try {
        unlinkSync(join(dir, f));
      } catch {
        /* ignore */
      }
    }
  }
}

export function removeLogo({ userName } = {}) {
  clearLogoFiles();
  setSetting('store_logo_filename', '');
  setSetting('store_logo_mime', '');
  writeAudit({
    action: 'settings.logo.remove',
    entityType: 'settings',
    userName,
  });
  return getLogoMeta();
}
