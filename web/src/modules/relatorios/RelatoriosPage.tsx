import { useEffect, useState } from 'react';
import {
  fetchReportCatalog,
  formatBRL,
  runReport,
  type ReportCatalogItem,
  type ReportResult,
} from '../../api/client';
import { ModuleToolbar } from '../../components/ModuleChrome';
import ChoosePrinterModal from '../../components/ChoosePrinterModal';
import { printDocument } from '../../lib/printDocument';

function columnLabel(col: string): string {
  return col
    .replace(/_cents$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(col: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'number' && /_cents$/i.test(col)) return formatBRL(value);
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  return String(value);
}

function formatTotal(key: string, value: unknown): string {
  if (typeof value === 'number' && /_cents$/i.test(key)) return formatBRL(value);
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  return String(value ?? '—');
}

export default function RelatoriosPage() {
  const [catalog, setCatalog] = useState<ReportCatalogItem[]>([]);
  const [reportId, setReportId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosePrinter, setChoosePrinter] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const items = await fetchReportCatalog();
        setCatalog(items);
        if (items[0]) setReportId(items[0].id);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar catálogo');
      }
    })();
  }, []);

  async function handleRun() {
    if (!reportId) {
      setError('Selecione um relatório');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await runReport(reportId, {
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar relatório');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-panel report-print-area">
      <ModuleToolbar>
        <label className="toolbar-field">
          Relatório
          <select
            className="field-input"
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
          >
            {catalog.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-field">
          De
          <input
            className="field-input"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="toolbar-field">
          Até
          <input
            className="field-input"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !reportId}
          onClick={() => void handleRun()}
        >
          {busy ? 'Gerando…' : 'Visualizar'}
        </button>
        <button
          type="button"
          className="btn btn-ghost no-print"
          disabled={!result}
          onClick={() => setChoosePrinter(true)}
        >
          Imprimir
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {choosePrinter && result && (
        <ChoosePrinterModal
          kind="report"
          title="Escolher impressora"
          onCancel={() => setChoosePrinter(false)}
          onConfirm={(choice) => {
            setChoosePrinter(false);
            void printDocument({
              kind: 'report',
              title: result.title,
              documentType: 'relatorio',
              documentRef: result.id,
              printerName: choice.printerName || undefined,
              paperFormat: choice.paperFormat,
            }).then((res) => {
              if (!res.ok) setError(res.error || 'Não foi possível imprimir o relatório.');
            });
          }}
        />
      )}

      {!result ? (
        <p className="cart-empty">Selecione um relatório e clique em Visualizar.</p>
      ) : (
        <div className="report-result">
          <div className="report-heading">
            <h3>{result.title}</h3>
            {result.generated_at ? (
              <p className="muted-line">Gerado em {result.generated_at}</p>
            ) : null}
          </div>

          {result.totals && Object.keys(result.totals).length > 0 ? (
            <div className="stats-row report-totals">
              {Object.entries(result.totals).map(([key, value]) => (
                <div className="stat-card" key={key}>
                  <span>{columnLabel(key)}</span>
                  <strong>{formatTotal(key, value)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className="product-table-wrap">
            <table className="product-table report-table">
              <thead>
                <tr>
                  {(result.columns || []).map((col) => (
                    <th key={col}>{columnLabel(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(result.rows || []).map((row, idx) => (
                  <tr key={idx}>
                    {(result.columns || []).map((col) => (
                      <td key={col}>{formatCell(col, row[col])}</td>
                    ))}
                  </tr>
                ))}
                {(result.rows || []).length === 0 && (
                  <tr>
                    <td colSpan={Math.max(result.columns?.length || 1, 1)}>Sem dados no período.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
