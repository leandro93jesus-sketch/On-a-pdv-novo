import { useEffect, useState } from 'react';

export interface ChoosePrinterResult {
  printerName: string;
  remember: boolean;
  paperFormat?: string;
}

interface Props {
  title?: string;
  kind?: 'receipt' | 'report' | 'delivery';
  defaultPrinter?: string;
  defaultFormat?: string;
  onConfirm: (result: ChoosePrinterResult) => void;
  onCancel: () => void;
}

const REMEMBER_KEY = 'onca-pdv-remember-printer';

export function getRememberedPrinter(kind = 'receipt'): string | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, string>;
    return obj[kind] || null;
  } catch {
    return null;
  }
}

export function setRememberedPrinter(kind: string, name: string) {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    obj[kind] = name;
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

export default function ChoosePrinterModal({
  title = 'Escolher impressora',
  kind = 'receipt',
  defaultPrinter = '',
  defaultFormat = 'A4',
  onConfirm,
  onCancel,
}: Props) {
  const [printers, setPrinters] = useState<Array<{ name: string; displayName?: string; isDefault?: boolean }>>(
    []
  );
  const [selected, setSelected] = useState(
    () => getRememberedPrinter(kind) || defaultPrinter || ''
  );
  const [remember, setRemember] = useState(Boolean(getRememberedPrinter(kind)));
  const [format, setFormat] = useState(defaultFormat || 'A4');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setBusy(true);
      try {
        if (window.oncaDesktop?.listPrinters) {
          const res = await window.oncaDesktop.listPrinters();
          setPrinters(res.printers || []);
          if (res.error) setNote(res.error);
          if (!selected && res.printers?.length) {
            const def = res.printers.find((p) => p.isDefault) || res.printers[0];
            setSelected(def.name);
          }
        } else {
          setNote(
            'Listagem completa disponível no aplicativo desktop. No navegador, a impressão usa o diálogo do sistema.'
          );
        }
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirm() {
    if (remember && selected) setRememberedPrinter(kind, selected);
    onConfirm({ printerName: selected, remember, paperFormat: format });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p className="muted-line">Selecione a impressora para este documento. A venda já concluída não é afetada.</p>
        {note && <div className="alert alert-ok">{note}</div>}
        <div className="form-grid">
          <label className="span-2">
            Impressora
            <select
              className="field-input"
              value={selected}
              disabled={busy}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">— padrão do sistema —</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}
                  {p.isDefault ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Papel
            <select className="field-input" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="A4">A4</option>
              <option value="80mm">80 mm</option>
              <option value="58mm">58 mm</option>
            </select>
          </label>
          <label className="check-inline span-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Lembrar minha escolha
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            Usar esta impressora
          </button>
        </div>
      </div>
    </div>
  );
}
