export interface DesktopPrinter {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
}

export interface DesktopBluetoothDevice {
  name: string;
  address?: string;
  paired?: boolean;
  connected?: boolean;
  available?: boolean;
}

export interface OncaDesktopApi {
  platform: string;
  isDesktop: boolean;
  listPrinters?: () => Promise<{
    printers: DesktopPrinter[];
    error?: string;
    timeout?: boolean;
  }>;
  testPrint?: (opts?: {
    deviceName?: string;
    copies?: number;
  }) => Promise<{ ok: boolean; error?: string; timeout?: boolean }>;
  listBluetoothDevices?: () => Promise<{
    devices: DesktopBluetoothDevice[];
    error?: string;
    timeout?: boolean;
    cancelled?: boolean;
  }>;
  scanBluetooth?: () => Promise<{
    devices: DesktopBluetoothDevice[];
    error?: string;
    timeout?: boolean;
    cancelled?: boolean;
  }>;
  cancelBluetooth?: () => Promise<{ ok: boolean; cancelled?: boolean }>;
  getLinuxPrintDiag?: () => Promise<Record<string, unknown>>;
  savePdf?: (opts: {
    defaultPath?: string;
    suggestedName?: string;
    title?: string;
    absolutePath?: string;
    url?: string;
    base64?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>;
}

declare global {
  interface Window {
    oncaDesktop?: OncaDesktopApi;
  }
}

export {};
