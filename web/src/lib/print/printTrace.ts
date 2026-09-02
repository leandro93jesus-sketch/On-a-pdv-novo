/**
 * Trilha temporária do fluxo de impressão.
 * Permite ver exatamente em qual etapa o cupom parou.
 */

export interface PrintTraceEntry {
  ts: string;
  step: string;
  detail?: unknown;
}

const traces: PrintTraceEntry[] = [];

export function clearPrintTraces(): void {
  traces.length = 0;
}

export function getPrintTraces(): PrintTraceEntry[] {
  return traces.slice();
}

export function printLog(step: string, detail?: unknown): PrintTraceEntry {
  const entry: PrintTraceEntry = {
    ts: new Date().toISOString(),
    step,
    detail: detail === undefined ? undefined : safeClone(detail),
  };
  traces.push(entry);
  if (detail === undefined) {
    console.log(`[PrintService] ${step}`);
  } else {
    console.log(`[PrintService] ${step}`, entry.detail);
  }
  return entry;
}

export function formatPrintTraces(entries: PrintTraceEntry[] = traces): string {
  return entries
    .map((e) => {
      const extra = e.detail === undefined ? '' : ` ${summarize(e.detail)}`;
      return `${e.ts} ${e.step}${extra}`;
    })
    .join('\n');
}

function safeClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function summarize(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return String(value);
  }
}
