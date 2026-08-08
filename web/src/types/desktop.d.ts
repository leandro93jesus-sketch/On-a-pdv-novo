export interface DesktopPrinter {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
}

export interface OncaDesktopApi {
  platform: string;
  isDesktop: boolean;
  listPrinters?: () => Promise<{ printers: DesktopPrinter[]; error?: string }>;
  testPrint?: (opts?: {
    deviceName?: string;
    copies?: number;
  }) => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    oncaDesktop?: OncaDesktopApi;
  }
}

export {};
