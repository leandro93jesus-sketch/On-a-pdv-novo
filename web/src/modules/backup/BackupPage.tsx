import { useEffect, useState } from 'react';
import {
  createBackupApi,
  executeImportApi,
  fileToBase64,
  listBackupsApi,
  listImportRunsApi,
  previewImportApi,
  previewRestoreApi,
  restoreBackupApi,
  uploadBackupApi,
  type BackupRecord,
  type ImportRun,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

type Tab = 'backup' | 'import';

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BackupPage() {
  const [tab, setTab] = useState<Tab>('backup');
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restorePreview, setRestorePreview] = useState<Record<string, unknown> | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportRun | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [importReport, setImportReport] = useState<Record<string, unknown> | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);

  async function loadBackups() {
    setBackups(await listBackupsApi());
  }

  async function loadImports() {
    setImportRuns(await listImportRunsApi());
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadBackups();
        await loadImports();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar');
      }
    })();
  }, []);

  async function createBackup() {
    setBusy(true);
    setError(null);
    try {
      await createBackupApi({ notes: 'Backup manual' });
      setNotice('Backup criado com sucesso.');
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar backup');
    } finally {
      setBusy(false);
    }
  }

  async function openRestore(b: BackupRecord) {
    setBusy(true);
    setError(null);
    setRestoreConfirm(false);
    try {
      const preview = await previewRestoreApi(b.filepath);
      setRestoreTarget(b);
      setRestorePreview(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na prévia de restauração');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!restoreTarget || !restoreConfirm) {
      setError('Marque a confirmação para restaurar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await restoreBackupApi(restoreTarget.filepath, true);
      setNotice('Restauração concluída. Recarregue a página se necessário.');
      setRestoreTarget(null);
      setRestorePreview(null);
      setRestoreConfirm(false);
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao restaurar');
    } finally {
      setBusy(false);
    }
  }

  async function uploadDb() {
    if (!uploadFile) {
      setError('Selecione um arquivo .db');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const b64 = await fileToBase64(uploadFile);
      await uploadBackupApi(uploadFile.name, b64);
      setNotice('Arquivo enviado e validado.');
      setUploadFile(null);
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no upload');
    } finally {
      setBusy(false);
    }
  }

  async function previewImport() {
    if (!importFile) {
      setError('Selecione um arquivo JSON');
      return;
    }
    setBusy(true);
    setError(null);
    setImportReport(null);
    setImportConfirm(false);
    try {
      const b64 = await fileToBase64(importFile);
      const preview = await previewImportApi({
        filename: importFile.name,
        content_base64: b64,
      });
      setImportPreview(preview);
      setNotice('Prévia da importação gerada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na prévia');
      setImportPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!importFile || !importConfirm) {
      setError('Confirme a importação antes de executar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const b64 = await fileToBase64(importFile);
      const report = await executeImportApi({
        filename: importFile.name,
        content_base64: b64,
        confirm: true,
        run_id: importPreview?.id,
      });
      setImportReport(report);
      setNotice('Importação executada.');
      await loadImports();
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na importação');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-panel">
      <div className="tabs" role="tablist">
        <button
          type="button"
          className={`tab${tab === 'backup' ? ' active' : ''}`}
          onClick={() => setTab('backup')}
        >
          Backup / Restauração
        </button>
        <button
          type="button"
          className={`tab${tab === 'import' ? ' active' : ''}`}
          onClick={() => setTab('import')}
        >
          Importar JSON antigo
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {tab === 'backup' ? (
        <>
          <ModuleToolbar>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void createBackup()}
            >
              Criar backup agora
            </button>
            <label className="toolbar-field">
              Enviar .db
              <input
                type="file"
                accept=".db"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !uploadFile}
              onClick={() => void uploadDb()}
            >
              Enviar arquivo
            </button>
          </ModuleToolbar>

          <div className="product-table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Tipo</th>
                  <th>Tamanho</th>
                  <th>Criado em</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.filename}
                      {b.created_by ? <div className="muted-line">por {b.created_by}</div> : null}
                    </td>
                    <td>{b.kind || '—'}</td>
                    <td>{formatBytes(b.size_bytes)}</td>
                    <td>{b.created_at || '—'}</td>
                    <td>
                      <StatusPill tone={b.exists === false ? 'danger' : b.valid ? 'ok' : 'warn'}>
                        {b.exists === false ? 'Ausente' : b.valid ? 'Válido' : 'Atenção'}
                      </StatusPill>
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy || b.exists === false}
                        onClick={() => void openRestore(b)}
                      >
                        Restaurar
                      </button>
                    </td>
                  </tr>
                ))}
                {backups.length === 0 && (
                  <tr>
                    <td colSpan={6}>Nenhum backup registrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {restoreTarget && restorePreview && (
            <div className="modal-backdrop">
              <div className="modal modal-wide">
                <h3>Restaurar backup</h3>
                <p>
                  Arquivo: <strong>{restoreTarget.filename}</strong>
                </p>
                <pre className="code-block">{JSON.stringify(restorePreview, null, 2)}</pre>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={restoreConfirm}
                    onChange={(e) => setRestoreConfirm(e.target.checked)}
                  />
                  Confirmo que desejo substituir o banco atual por este backup
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setRestoreTarget(null);
                      setRestorePreview(null);
                      setRestoreConfirm(false);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy || !restoreConfirm}
                    onClick={() => void confirmRestore()}
                  >
                    Restaurar agora
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <ModuleToolbar>
            <label className="toolbar-field">
              Arquivo JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] || null);
                  setImportPreview(null);
                  setImportReport(null);
                  setImportConfirm(false);
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !importFile}
              onClick={() => void previewImport()}
            >
              Pré-visualizar
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={busy || !importPreview || !importConfirm}
              onClick={() => void runImport()}
            >
              Executar importação
            </button>
          </ModuleToolbar>

          {importPreview && (
            <div className="side-card import-preview">
              <h3>Prévia da importação #{importPreview.id}</h3>
              <pre className="code-block">
                {JSON.stringify(
                  {
                    analysis: importPreview.analysis,
                    preview: importPreview.preview,
                  },
                  null,
                  2
                )}
              </pre>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={importConfirm}
                  onChange={(e) => setImportConfirm(e.target.checked)}
                />
                Confirmo a importação (será criado backup automático antes)
              </label>
            </div>
          )}

          {importReport && (
            <div className="side-card">
              <h3>Relatório da importação</h3>
              <pre className="code-block">{JSON.stringify(importReport, null, 2)}</pre>
            </div>
          )}

          <div className="product-table-wrap" style={{ marginTop: 16 }}>
            <h3>Histórico de importações</h3>
            <table className="product-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Arquivo</th>
                  <th>Status</th>
                  <th>Criado em</th>
                  <th>Por</th>
                </tr>
              </thead>
              <tbody>
                {importRuns.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.source_filename || '—'}</td>
                    <td>
                      <StatusPill
                        tone={
                          r.status === 'completed' || r.status === 'done'
                            ? 'ok'
                            : r.status === 'failed' || r.status === 'error'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {r.status || '—'}
                      </StatusPill>
                    </td>
                    <td>{r.created_at || '—'}</td>
                    <td>{r.created_by || '—'}</td>
                  </tr>
                ))}
                {importRuns.length === 0 && (
                  <tr>
                    <td colSpan={5}>Nenhuma importação registrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
