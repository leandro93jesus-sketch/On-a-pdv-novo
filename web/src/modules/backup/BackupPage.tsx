import { useEffect, useState } from 'react';
import {
  createBackupApi,
  executeImportApi,
  fetchActiveDbInfoApi,
  fileToBase64,
  listBackupsApi,
  listImportRunsApi,
  previewImportApi,
  previewRestoreApi,
  restoreBackupApi,
  uploadBackupApi,
  type ActiveDbInfo,
  type BackupRecord,
  type ImportRun,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

type Tab = 'backup' | 'import';

function formatBytes(n?: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function countVal(
  counts: Record<string, unknown> | null | undefined,
  key: string
): string {
  if (!counts || counts[key] == null) return '—';
  return String(counts[key]);
}

export default function BackupPage() {
  const [tab, setTab] = useState<Tab>('backup');
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
  const [activeDb, setActiveDb] = useState<ActiveDbInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restorePreview, setRestorePreview] = useState<Record<string, unknown> | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [allowOverwriteNewer, setAllowOverwriteNewer] = useState(false);
  const [restoreReport, setRestoreReport] = useState<Record<string, unknown> | null>(null);

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

  async function loadActiveDb() {
    setActiveDb(await fetchActiveDbInfoApi());
  }

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadBackups(), loadImports(), loadActiveDb()]);
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
      await loadActiveDb();
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
    setAllowOverwriteNewer(false);
    setRestoreReport(null);
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
    const needsForce = Boolean(restorePreview?.requires_allow_overwrite_newer_data);
    if (needsForce && !allowOverwriteNewer) {
      setError(
        'O banco atual parece mais novo que este backup. Marque a confirmação de sobrescrita ou cancele para preservar os dados atuais.'
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackupApi(
        restoreTarget.filepath,
        true,
        needsForce ? allowOverwriteNewer : false
      );
      if (!result.ok || !result.verified) {
        setError('Restauração não verificada. Os dados podem não ter sido carregados.');
        return;
      }
      setRestoreReport(result);
      setNotice(
        String(
          result.message ||
            'RESTAURAÇÃO CONCLUÍDA. O ONÇA PDV SERÁ RECARREGADO PARA CARREGAR OS DADOS.'
        )
      );
      setRestoreTarget(null);
      setRestorePreview(null);
      setRestoreConfirm(false);
      setAllowOverwriteNewer(false);
      await loadBackups();
      await loadActiveDb();
      window.setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao restaurar');
    } finally {
      setBusy(false);
    }
  }

  async function uploadDb() {
    if (!uploadFile) {
      setError('Selecione um arquivo .db ou .sqlite');
      return;
    }
    const name = uploadFile.name.toLowerCase();
    if (name.endsWith('.json')) {
      setError('Arquivo JSON detectado. Use a aba IMPORTAR BACKUP ANTIGO JSON.');
      return;
    }
    setBusy(true);
    setError(null);
    setRestoreReport(null);
    try {
      const b64 = await fileToBase64(uploadFile);
      const uploaded = await uploadBackupApi(uploadFile.name, b64);
      setNotice(
        `Arquivo validado e registrado: ${String(uploaded.filename || uploadFile.name)}. Revise a prévia.`
      );
      setUploadFile(null);
      await loadBackups();
      const filepath = String(uploaded.filepath || '');
      if (filepath) {
        const preview =
          (uploaded.preview as Record<string, unknown> | undefined) ||
          (await previewRestoreApi(filepath));
        setRestoreTarget({
          id: typeof uploaded.id === 'number' ? uploaded.id : null,
          filename: String(uploaded.filename || uploadFile.name),
          filepath,
          size_bytes: Number(uploaded.size_bytes || uploadFile.size),
          kind: 'uploaded',
          exists: true,
          valid: true,
        });
        setRestorePreview(preview);
        setRestoreConfirm(false);
        setAllowOverwriteNewer(false);
      }
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
    if (!importFile.name.toLowerCase().endsWith('.json')) {
      setError('Esta aba aceita apenas JSON. Para .db/.sqlite use Restaurar Backup ONÇA PDV.');
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
      setNotice('Prévia da importação JSON gerada. Confira as contagens antes de importar.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'BACKUP JSON NÃO RECONHECIDO');
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
      setNotice('Importação JSON executada. Recarregando para exibir os dados…');
      await loadImports();
      await loadBackups();
      await loadActiveDb();
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na importação');
    } finally {
      setBusy(false);
    }
  }

  const previewCounts = (restorePreview?.counts_in_backup || {}) as Record<string, unknown>;
  const currentCounts = (restorePreview?.counts_current || activeDb?.counts || {}) as Record<
    string,
    unknown
  >;
  const fileMeta = (restorePreview?.file || {}) as Record<string, unknown>;

  return (
    <section className="module-panel">
      <div className="tabs" role="tablist">
        <button
          type="button"
          className={`tab${tab === 'backup' ? ' active' : ''}`}
          onClick={() => setTab('backup')}
        >
          Restaurar Backup ONÇA PDV (.db)
        </button>
        <button
          type="button"
          className={`tab${tab === 'import' ? ' active' : ''}`}
          onClick={() => setTab('import')}
        >
          Importar Backup Antigo JSON
        </button>
      </div>

      <div className="side-card" style={{ marginBottom: 12 }}>
        <h3>BANCO ATUAL EM USO</h3>
        <p className="muted-line" style={{ wordBreak: 'break-all' }}>
          {activeDb?.db_path || 'Carregando…'}
        </p>
        {activeDb ? (
          <div className="kv-list">
            <div>
              <span>Arquivo</span>
              <strong>{activeDb.filename}</strong>
            </div>
            <div>
              <span>Tamanho</span>
              <strong>{formatBytes(activeDb.size_bytes)}</strong>
            </div>
            <div>
              <span>Alterado em</span>
              <strong>{activeDb.mtime || '—'}</strong>
            </div>
            <div>
              <span>Produtos</span>
              <strong>{countVal(activeDb.counts || undefined, 'products')}</strong>
            </div>
            <div>
              <span>Clientes</span>
              <strong>{countVal(activeDb.counts || undefined, 'customers')}</strong>
            </div>
            <div>
              <span>Vendas</span>
              <strong>{countVal(activeDb.counts || undefined, 'sales')}</strong>
            </div>
          </div>
        ) : null}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {restoreReport && (
        <div className="side-card" style={{ marginBottom: 12 }}>
          <h3>Resultado da restauração (verificado)</h3>
          <div className="kv-list">
            <div>
              <span>Destino</span>
              <strong style={{ wordBreak: 'break-all' }}>
                {String(restoreReport.destination_db || '—')}
              </strong>
            </div>
            <div>
              <span>PRE-RESTAURACAO</span>
              <strong>
                {String(
                  (restoreReport.safety_backup as { filename?: string } | undefined)?.filename ||
                    '—'
                )}
              </strong>
            </div>
            <div>
              <span>Produtos antes → depois</span>
              <strong>
                {countVal(restoreReport.counts_before as Record<string, unknown>, 'products')} →{' '}
                {countVal(restoreReport.counts_after as Record<string, unknown>, 'products')}
              </strong>
            </div>
            <div>
              <span>Clientes antes → depois</span>
              <strong>
                {countVal(restoreReport.counts_before as Record<string, unknown>, 'customers')} →{' '}
                {countVal(restoreReport.counts_after as Record<string, unknown>, 'customers')}
              </strong>
            </div>
            <div>
              <span>Vendas antes → depois</span>
              <strong>
                {countVal(restoreReport.counts_before as Record<string, unknown>, 'sales')} →{' '}
                {countVal(restoreReport.counts_after as Record<string, unknown>, 'sales')}
              </strong>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' ? (
        <>
          <p className="muted-line" style={{ marginBottom: 12 }}>
            Esta aba restaura apenas backups <strong>.db / .sqlite</strong> do ONÇA PDV. JSON do
            sistema antigo fica na outra aba.
          </p>
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
              Enviar .db / .sqlite
              <input
                type="file"
                accept=".db,.sqlite,application/x-sqlite3"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !uploadFile}
              onClick={() => void uploadDb()}
            >
              Validar e pré-visualizar
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
                  <tr key={b.filepath || String(b.id)}>
                    <td>
                      {b.filename}
                      {b.created_by ? <div className="muted-line">por {b.created_by}</div> : null}
                      <div className="muted-line" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                        {b.filepath}
                      </div>
                    </td>
                    <td>{b.kind || '—'}</td>
                    <td>{formatBytes(b.size_bytes)}</td>
                    <td>{b.created_at || '—'}</td>
                    <td>
                      <StatusPill tone={b.exists === false ? 'danger' : b.valid ? 'ok' : 'warn'}>
                        {b.exists === false ? 'Ausente' : b.valid ? 'Válido' : 'Disco'}
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
                <h3>Prévia — Restaurar backup SQLite</h3>
                <div className="kv-list">
                  <div>
                    <span>ARQUIVO</span>
                    <strong>{String(fileMeta.filename || restoreTarget.filename)}</strong>
                  </div>
                  <div>
                    <span>TIPO</span>
                    <strong>DB</strong>
                  </div>
                  <div>
                    <span>TAMANHO</span>
                    <strong>{formatBytes(Number(fileMeta.size_bytes || restoreTarget.size_bytes))}</strong>
                  </div>
                  <div>
                    <span>DATA/HORA</span>
                    <strong>{String(fileMeta.mtime || restoreTarget.created_at || '—')}</strong>
                  </div>
                  <div>
                    <span>integrity_check</span>
                    <strong>{String(restorePreview.integrity_check || '—')}</strong>
                  </div>
                  <div>
                    <span>foreign_key_check</span>
                    <strong>{String(restorePreview.foreign_key_check || '—')}</strong>
                  </div>
                  <div>
                    <span>BANCO DE DESTINO</span>
                    <strong style={{ wordBreak: 'break-all' }}>
                      {String(restorePreview.destination_db || activeDb?.db_path || '—')}
                    </strong>
                  </div>
                </div>

                <div className="cash-grid" style={{ marginTop: 12 }}>
                  <div className="side-card">
                    <h3>No backup</h3>
                    <p>Produtos: {countVal(previewCounts, 'products')}</p>
                    <p>Clientes: {countVal(previewCounts, 'customers')}</p>
                    <p>Vendas: {countVal(previewCounts, 'sales')}</p>
                    <p>Estoque (mov.): {countVal(previewCounts, 'stock_movements')}</p>
                    <p>Crediário: {countVal(previewCounts, 'credit_accounts')}</p>
                    <p>Fornecedores: {countVal(previewCounts, 'suppliers')}</p>
                  </div>
                  <div className="side-card">
                    <h3>Banco atual (será substituído)</h3>
                    <p>Produtos: {countVal(currentCounts, 'products')}</p>
                    <p>Clientes: {countVal(currentCounts, 'customers')}</p>
                    <p>Vendas: {countVal(currentCounts, 'sales')}</p>
                    <p>Estoque (mov.): {countVal(currentCounts, 'stock_movements')}</p>
                    <p>Crediário: {countVal(currentCounts, 'credit_accounts')}</p>
                    <p>Fornecedores: {countVal(currentCounts, 'suppliers')}</p>
                  </div>
                </div>

                <p className="muted-line" style={{ marginTop: 10 }}>
                  {String(restorePreview.warning || '')} Será criado{' '}
                  <strong>PRE-RESTAURACAO-*</strong> antes.
                </p>
                {restorePreview.app_version ? (
                  <p className="muted-line">Versão do backup: {String(restorePreview.app_version)}</p>
                ) : null}
                {restorePreview.current_has_newer_data ? (
                  <p style={{ color: 'var(--danger, #b42318)', marginTop: 8 }}>
                    Banco atual parece mais novo/completo. Preferir preservar o banco atual.
                  </p>
                ) : null}

                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={restoreConfirm}
                    onChange={(e) => setRestoreConfirm(e.target.checked)}
                  />
                  Confirmo restaurar este backup no banco atual em uso
                </label>
                {restorePreview.requires_allow_overwrite_newer_data ? (
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={allowOverwriteNewer}
                      onChange={(e) => setAllowOverwriteNewer(e.target.checked)}
                    />
                    Entendo que o banco atual parece mais novo e desejo sobrescrever mesmo assim
                  </label>
                ) : null}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setRestoreTarget(null);
                      setRestorePreview(null);
                      setRestoreConfirm(false);
                      setAllowOverwriteNewer(false);
                    }}
                  >
                    CANCELAR
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={
                      busy ||
                      !restoreConfirm ||
                      (Boolean(restorePreview.requires_allow_overwrite_newer_data) &&
                        !allowOverwriteNewer)
                    }
                    onClick={() => void confirmRestore()}
                  >
                    IMPORTAR / RESTAURAR
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted-line" style={{ marginBottom: 12 }}>
            <strong>IMPORTAR SISTEMA ANTIGO</strong> — arquivo <strong>.json</strong> (não é
            restauração SQLite). Não tente abrir JSON como banco.
          </p>
          <ModuleToolbar>
            <label className="toolbar-field">
              Arquivo JSON antigo
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
              Validar e pré-visualizar
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={busy || !importPreview || !importConfirm}
              onClick={() => void runImport()}
            >
              IMPORTAR / RESTAURAR
            </button>
          </ModuleToolbar>

          {importFile && (
            <div className="side-card" style={{ marginBottom: 12 }}>
              <h3>Arquivo selecionado</h3>
              <div className="kv-list">
                <div>
                  <span>ARQUIVO</span>
                  <strong>{importFile.name}</strong>
                </div>
                <div>
                  <span>TIPO</span>
                  <strong>JSON</strong>
                </div>
                <div>
                  <span>TAMANHO</span>
                  <strong>{formatBytes(importFile.size)}</strong>
                </div>
              </div>
            </div>
          )}

          {importPreview && (
            <div className="side-card import-preview">
              <h3>Prévia da importação JSON #{importPreview.id}</h3>
              <div className="kv-list" style={{ marginBottom: 12 }}>
                <div>
                  <span>Adaptador</span>
                  <strong>
                    {String(
                      (importPreview.preview as { adapter?: string } | undefined)?.adapter ||
                        importPreview.analysis?.adapter ||
                        '—'
                    )}
                  </strong>
                </div>
                <div>
                  <span>SHA-256</span>
                  <strong style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    {String(importPreview.sha256 || importPreview.preview?.sha256 || '—')}
                  </strong>
                </div>
              </div>
              <div className="cash-grid" style={{ marginBottom: 12 }}>
                <div className="side-card">
                  <h3>Registros no arquivo</h3>
                  <pre className="code-block">
                    {JSON.stringify(
                      (importPreview.preview as { counts?: unknown })?.counts ||
                        importPreview.preview,
                      null,
                      2
                    )}
                  </pre>
                </div>
                <div className="side-card">
                  <h3>Conflitos com banco atual</h3>
                  <pre className="code-block">
                    {JSON.stringify(
                      (importPreview.db_conflicts as { totals?: unknown } | undefined)?.totals ||
                        (importPreview.preview as { db_conflicts?: { totals?: unknown } })
                          ?.db_conflicts?.totals ||
                        {},
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
              <label className="check-inline" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={importConfirm}
                  onChange={(e) => setImportConfirm(e.target.checked)}
                />
                Confirmo a importação JSON (backup automático + integrity/FK; rollback em erro)
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
