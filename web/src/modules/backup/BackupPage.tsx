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

function mapRestoreError(e: unknown): string {
  if (!(e instanceof Error)) return 'Erro ao restaurar';
  const code = (e as Error & { code?: string }).code || '';
  const msg = e.message || '';
  if (code === 'BACKUP_INVALID' || /BACKUP INVÁLIDO/i.test(msg)) return msg || 'BACKUP INVÁLIDO';
  if (code === 'BACKUP_CORRUPT' || /BANCO CORROMPIDO/i.test(msg)) return msg || 'BANCO CORROMPIDO';
  if (code === 'PRE_RESTORE_BACKUP_FAILED') return msg || 'FALHA AO CRIAR BACKUP DO BANCO ATUAL';
  if (code === 'DB_CLOSE_FAILED') return msg || 'FALHA AO FECHAR CONEXÃO';
  if (code === 'RESTORE_COPY_FAILED') return msg || 'FALHA AO COPIAR BANCO';
  if (code === 'DB_PATH_MISMATCH') return msg || 'API ESTÁ ABRINDO OUTRO BANCO';
  if (code === 'RESTORE_MIGRATION_FAILED') return msg || 'FALHA NA MIGRATION';
  if (code === 'CURRENT_DB_NEWER_THAN_BACKUP') {
    return (
      msg ||
      'ATENÇÃO: O BANCO ATUAL PODE CONTER VENDAS MAIS RECENTES.'
    );
  }
  return msg || 'Erro ao restaurar';
}

export default function BackupPage() {
  const [tab, setTab] = useState<Tab>('backup');
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
  const [activeDb, setActiveDb] = useState<ActiveDbInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restorePreview, setRestorePreview] = useState<Record<string, unknown> | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [allowOverwriteNewer, setAllowOverwriteNewer] = useState(false);
  const [restoreReport, setRestoreReport] = useState<Record<string, unknown> | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportRun | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [importReport, setImportReport] = useState<Record<string, unknown> | null>(null);

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
    setRestoreConfirm(true);
    setAllowOverwriteNewer(false);
    setRestoreReport(null);
    try {
      const preview = await previewRestoreApi(b.filepath);
      setRestoreTarget(b);
      setRestorePreview(preview);
    } catch (e) {
      setError(mapRestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore(forceNewer = false) {
    if (!restoreTarget) {
      setError('Nenhum backup selecionado.');
      return;
    }
    const needsForce = Boolean(restorePreview?.requires_allow_overwrite_newer_data);
    if (needsForce && !forceNewer && !allowOverwriteNewer) {
      setError('ATENÇÃO: O BANCO ATUAL PODE CONTER VENDAS MAIS RECENTES.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackupApi(
        restoreTarget.filepath,
        true,
        needsForce ? true : false
      );
      if (!result.ok || !result.verified) {
        setError('Restauração não verificada. Os dados podem não ter sido carregados.');
        return;
      }
      setRestoreReport(result);
      setNotice(String(result.message || 'BACKUP RESTAURADO'));
      setRestoreTarget(null);
      setRestorePreview(null);
      setRestoreConfirm(false);
      setAllowOverwriteNewer(false);
      await loadBackups();
      await loadActiveDb();
      window.setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      setError(mapRestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function selectBackupFile(file: File | null) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.json')) {
      setError('Arquivo JSON detectado. Use a aba IMPORTAR BACKUP ANTIGO JSON.');
      return;
    }
    if (!/\.(db|sqlite|sqlite3)$/i.test(name)) {
      setError('BACKUP INVÁLIDO — use .db, .sqlite ou .sqlite3');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setRestoreReport(null);
    try {
      const b64 = await fileToBase64(file);
      const uploaded = await uploadBackupApi(file.name, b64);
      await loadBackups();
      const filepath = String(uploaded.filepath || '');
      if (!filepath) {
        setError('BACKUP INVÁLIDO — arquivo não foi registrado');
        return;
      }
      const preview =
        (uploaded.preview as Record<string, unknown> | undefined) ||
        (await previewRestoreApi(filepath));
      if (String(preview.integrity_check || '') !== 'ok') {
        setError('BANCO CORROMPIDO — integrity_check falhou');
        return;
      }
      setRestoreTarget({
        id: typeof uploaded.id === 'number' ? uploaded.id : null,
        filename: String(uploaded.filename || file.name),
        filepath,
        size_bytes: Number(uploaded.size_bytes || file.size),
        kind: 'uploaded',
        exists: true,
        valid: true,
      });
      setRestorePreview(preview);
      setRestoreConfirm(true);
      setAllowOverwriteNewer(false);
      setNotice('BACKUP ENCONTRADO — revise a prévia antes de restaurar.');
      setFileInputKey((k) => k + 1);
    } catch (e) {
      setError(mapRestoreError(e));
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
          <h3>BACKUP RESTAURADO</h3>
          <div className="kv-list">
            <div>
              <span>BANCO ATIVO</span>
              <strong style={{ wordBreak: 'break-all' }}>
                {String(restoreReport.active_db_after || restoreReport.destination_db || '—')}
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
              <span>Produtos</span>
              <strong>
                {countVal(restoreReport.counts_after as Record<string, unknown>, 'products')}
              </strong>
            </div>
            <div>
              <span>Clientes</span>
              <strong>
                {countVal(restoreReport.counts_after as Record<string, unknown>, 'customers')}
              </strong>
            </div>
            <div>
              <span>Vendas</span>
              <strong>
                {countVal(restoreReport.counts_after as Record<string, unknown>, 'sales')}
              </strong>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' ? (
        <>
          <p className="muted-line" style={{ marginBottom: 12 }}>
            Selecione um backup <strong>.db / .sqlite / .sqlite3</strong>. O sistema valida e mostra
            a prévia — a restauração só ocorre após confirmação.
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
            <label className="btn btn-accent" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              SELECIONAR BACKUP
              <input
                key={fileInputKey}
                type="file"
                accept=".db,.sqlite,.sqlite3,application/x-sqlite3"
                hidden
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  void selectBackupFile(f);
                }}
              />
            </label>
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
                <h3>BACKUP ENCONTRADO</h3>
                <div className="kv-list">
                  <div>
                    <span>Arquivo</span>
                    <strong>{String(fileMeta.filename || restoreTarget.filename)}</strong>
                  </div>
                  <div>
                    <span>Data</span>
                    <strong>{String(fileMeta.mtime || restoreTarget.created_at || '—')}</strong>
                  </div>
                  <div>
                    <span>Tamanho</span>
                    <strong>{formatBytes(Number(fileMeta.size_bytes || restoreTarget.size_bytes))}</strong>
                  </div>
                  <div>
                    <span>Versão</span>
                    <strong>{String(restorePreview.app_version || '—')}</strong>
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
                    <span>BANCO ATIVO</span>
                    <strong style={{ wordBreak: 'break-all' }}>
                      {String(restorePreview.destination_db || activeDb?.db_path || '—')}
                    </strong>
                  </div>
                  <div>
                    <span>BANCO SELECIONADO</span>
                    <strong style={{ wordBreak: 'break-all' }}>
                      {String(restoreTarget.filepath)}
                    </strong>
                  </div>
                </div>

                <div className="cash-grid" style={{ marginTop: 12 }}>
                  <div className="side-card">
                    <h3>Dados no backup</h3>
                    <p>Produtos: {countVal(previewCounts, 'products')}</p>
                    <p>Clientes: {countVal(previewCounts, 'customers')}</p>
                    <p>Vendas: {countVal(previewCounts, 'sales')}</p>
                    <p>Itens de venda: {countVal(previewCounts, 'sale_items')}</p>
                    <p>Pagamentos: {countVal(previewCounts, 'sale_payments')}</p>
                    <p>Movimentações de caixa: {countVal(previewCounts, 'cash_movements')}</p>
                    <p>Movimentações de estoque: {countVal(previewCounts, 'stock_movements')}</p>
                    <p>
                      Entregas:{' '}
                      {countVal(previewCounts, 'delivery_orders') !== '—'
                        ? countVal(previewCounts, 'delivery_orders')
                        : countVal(previewCounts, 'deliveries')}
                    </p>
                  </div>
                  <div className="side-card">
                    <h3>Banco atual</h3>
                    <p>Produtos: {countVal(currentCounts, 'products')}</p>
                    <p>Clientes: {countVal(currentCounts, 'customers')}</p>
                    <p>Vendas: {countVal(currentCounts, 'sales')}</p>
                    <p>Itens de venda: {countVal(currentCounts, 'sale_items')}</p>
                    <p>Pagamentos: {countVal(currentCounts, 'sale_payments')}</p>
                    <p>Movimentações de caixa: {countVal(currentCounts, 'cash_movements')}</p>
                    <p>Movimentações de estoque: {countVal(currentCounts, 'stock_movements')}</p>
                    <p>
                      Entregas:{' '}
                      {countVal(currentCounts, 'delivery_orders') !== '—'
                        ? countVal(currentCounts, 'delivery_orders')
                        : countVal(currentCounts, 'deliveries')}
                    </p>
                  </div>
                </div>

                <p className="muted-line" style={{ marginTop: 10 }}>
                  Antes da restauração será criado{' '}
                  <strong>ONCA-PDV-PRE-RESTAURACAO-*</strong>.
                </p>
                {restorePreview.current_has_newer_data ? (
                  <p style={{ color: 'var(--danger, #b42318)', marginTop: 8 }}>
                    ATENÇÃO: O BANCO ATUAL PODE CONTER VENDAS MAIS RECENTES.
                  </p>
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
                  {restorePreview.requires_allow_overwrite_newer_data ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => {
                        setAllowOverwriteNewer(true);
                        void confirmRestore(true);
                      }}
                    >
                      FAZER BACKUP E CONTINUAR
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy || !restoreConfirm}
                      onClick={() => void confirmRestore(false)}
                    >
                      RESTAURAR ESTE BACKUP
                    </button>
                  )}
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
