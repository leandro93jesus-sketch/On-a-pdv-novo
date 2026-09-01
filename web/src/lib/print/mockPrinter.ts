/**
 * Mock da impressora: grava o que SERIA enviado, sem hardware.
 * Testes automatizados DEVEM usar só este transporte.
 */

export interface MockPrintJob {
  text: string;
  bytes: Uint8Array;
  width: string;
  method: string;
  cut: boolean;
  printerName?: string;
  host?: string;
  port?: number;
}

export function createMockPrinter() {
  const jobs: MockPrintJob[] = [];
  return {
    kind: 'mock' as const,
    jobs,
    reset() {
      jobs.length = 0;
    },
    async send(job: MockPrintJob) {
      jobs.push({
        ...job,
        bytes: Uint8Array.from(job.bytes),
      });
      return { ok: true as const, via: 'mock', sent: false as const };
    },
  };
}

export type MockPrinter = ReturnType<typeof createMockPrinter>;
