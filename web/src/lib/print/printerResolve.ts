/**
 * Resolve o deviceName real contra a lista do sistema.
 * Não confia só no nome salvo nas configurações.
 */

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
  deviceName: string | undefined;
  displayName?: string;
  listedName?: string;
  source: 'windows-default' | 'matched-name' | 'matched-display' | 'os-default-fallback' | 'stale-fallback-default' | 'none';
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

function norm(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function findListedPrinter(printers: ListedPrinter[], wanted?: string | null): ListedPrinter | undefined {
  const target = norm(wanted || '');
  if (!target) return undefined;
  return (
    printers.find((p) => norm(p.name) === target) ||
    printers.find((p) => norm(p.displayName || '') === target) ||
    printers.find((p) => norm(p.name).includes(target) || norm(p.displayName || '').includes(target))
  );
}

export function resolveConfiguredPrinter(
  settings: PrinterSettingsLike | null | undefined,
  printers: ListedPrinter[],
  overrideName?: string | null
): PrinterResolveResult {
  const list = Array.isArray(printers) ? printers : [];
  const osDefault = list.find((p) => p.isDefault) || list[0];
  const savedName = String(overrideName || settings?.receipt_printer || settings?.default_printer || '').trim();
  const useDefault = Boolean(settings?.use_windows_default) && !overrideName;
  const comparison = list.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean(p.isDefault),
    matchesSaved: Boolean(savedName) && (norm(p.name) === norm(savedName) || norm(p.displayName || '') === norm(savedName)),
  }));

  if (useDefault) {
    return {
      deviceName: osDefault?.name,
      displayName: osDefault?.displayName || osDefault?.name,
      listedName: osDefault?.name,
      source: osDefault ? 'windows-default' : 'none',
      savedName: savedName || undefined,
      stale: Boolean(savedName) && !findListedPrinter(list, savedName),
      corrected: Boolean(savedName) && Boolean(osDefault) && norm(savedName) !== norm(osDefault.name),
      printers: list,
      comparison,
    };
  }

  if (savedName) {
    const matched = findListedPrinter(list, savedName);
    if (matched) {
      const byName = norm(matched.name) === norm(savedName);
      return {
        deviceName: matched.name,
        displayName: matched.displayName || matched.name,
        listedName: matched.name,
        source: byName ? 'matched-name' : 'matched-display',
        savedName,
        stale: false,
        corrected: !byName || matched.name !== savedName,
        printers: list,
        comparison,
      };
    }
    return {
      deviceName: osDefault?.name,
      displayName: osDefault?.displayName || osDefault?.name,
      listedName: osDefault?.name,
      source: osDefault ? 'stale-fallback-default' : 'none',
      savedName,
      stale: true,
      corrected: Boolean(osDefault),
      printers: list,
      comparison,
    };
  }

  return {
    deviceName: osDefault?.name,
    displayName: osDefault?.displayName || osDefault?.name,
    listedName: osDefault?.name,
    source: osDefault ? 'os-default-fallback' : 'none',
    stale: false,
    corrected: false,
    printers: list,
    comparison,
  };
}
