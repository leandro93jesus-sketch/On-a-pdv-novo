import { useEffect, useState } from 'react';
import {
  changeUserPasswordApi,
  createUserApi,
  fetchAuditLogs,
  fetchSettings,
  fetchUsers,
  getStoredAuthUser,
  updateSettings,
  updateUserApi,
  type AppUser,
  type AuditLog,
  type SettingsBundle,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

type Tab = 'empresa' | 'pdv' | 'usuarios' | 'auditoria';

const emptyUser = {
  name: '',
  login: '',
  password: '',
  role: 'operador',
  active: true,
};

export default function ConfiguracoesPage() {
  const me = getStoredAuthUser();
  const isAdmin = me?.role === 'administrador';

  const [tab, setTab] = useState<Tab>('empresa');
  const [settings, setSettings] = useState<SettingsBundle | null>(null);
  const [company, setCompany] = useState<Record<string, string>>({});
  const [pdv, setPdv] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<AppUser[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [userForm, setUserForm] = useState(emptyUser);

  const [auditAction, setAuditAction] = useState('');
  const [auditUser, setAuditUser] = useState('');

  async function loadSettings() {
    const bundle = await fetchSettings();
    setSettings(bundle);
    setCompany({ ...(bundle.company || {}) });
    setPdv({ ...(bundle.pdv || {}) });
  }

  async function loadUsers() {
    if (!isAdmin) return;
    setUsers(await fetchUsers());
  }

  async function loadAudit() {
    if (!isAdmin) return;
    setAudit(
      await fetchAuditLogs({
        limit: 100,
        action: auditAction.trim() || undefined,
        user_name: auditUser.trim() || undefined,
      })
    );
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadSettings();
        if (isAdmin) {
          await loadUsers();
          await loadAudit();
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar configurações');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, []);

  async function saveSettings(section: 'company' | 'pdv') {
    if (!isAdmin) {
      setError('Apenas administradores podem alterar configurações.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload =
        section === 'company' ? { company } : { pdv };
      const bundle = await updateSettings(payload);
      setSettings(bundle);
      setCompany({ ...(bundle.company || {}) });
      setPdv({ ...(bundle.pdv || {}) });
      setNotice('Configurações salvas.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setBusy(false);
    }
  }

  function openCreateUser() {
    setEditingUser(null);
    setUserForm(emptyUser);
    setShowUserForm(true);
  }

  function openEditUser(u: AppUser) {
    setEditingUser(u);
    setUserForm({
      name: u.name,
      login: u.login,
      password: '',
      role: u.role,
      active: Boolean(u.active),
    });
    setShowUserForm(true);
  }

  async function saveUser() {
    if (!userForm.name.trim() || !userForm.login.trim()) {
      setError('Nome e login são obrigatórios');
      return;
    }
    if (!editingUser && !userForm.password) {
      setError('Senha é obrigatória para novo usuário');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingUser) {
        await updateUserApi(editingUser.id, {
          name: userForm.name.trim(),
          role: userForm.role,
          active: userForm.active,
        });
        if (userForm.password) {
          await changeUserPasswordApi(editingUser.id, userForm.password);
        }
        setNotice('Usuário atualizado.');
      } else {
        await createUserApi({
          name: userForm.name.trim(),
          login: userForm.login.trim(),
          password: userForm.password,
          role: userForm.role,
        });
        setNotice('Usuário criado.');
      }
      setShowUserForm(false);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar usuário');
    } finally {
      setBusy(false);
    }
  }

  function setCompanyField(key: string, value: string) {
    setCompany((prev) => ({ ...prev, [key]: value }));
  }

  function setPdvField(key: string, value: string) {
    setPdv((prev) => ({ ...prev, [key]: value }));
  }

  function boolField(value: string | undefined): boolean {
    return value === '1' || value === 'true' || value === 'yes';
  }

  return (
    <section className="module-panel">
      <div className="tabs" role="tablist">
        {(
          [
            ['empresa', 'Empresa'],
            ['pdv', 'PDV'],
            ['usuarios', 'Usuários'],
            ['auditoria', 'Auditoria'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {tab === 'empresa' && (
        <>
          <div className="form-grid">
            <label className="span-2">
              Nome da loja
              <input
                className="field-input"
                value={company.store_name || ''}
                onChange={(e) => setCompanyField('store_name', e.target.value)}
              />
            </label>
            <label className="span-2">
              Nome fantasia
              <input
                className="field-input"
                value={company.store_trade_name || ''}
                onChange={(e) => setCompanyField('store_trade_name', e.target.value)}
              />
            </label>
            <label>
              CNPJ / documento
              <input
                className="field-input"
                value={company.store_document || ''}
                onChange={(e) => setCompanyField('store_document', e.target.value)}
              />
            </label>
            <label>
              Telefone
              <input
                className="field-input"
                value={company.store_phone || ''}
                onChange={(e) => setCompanyField('store_phone', e.target.value)}
              />
            </label>
            <label>
              WhatsApp
              <input
                className="field-input"
                value={company.store_whatsapp || ''}
                onChange={(e) => setCompanyField('store_whatsapp', e.target.value)}
              />
            </label>
            <label>
              Site
              <input
                className="field-input"
                value={company.store_site || ''}
                onChange={(e) => setCompanyField('store_site', e.target.value)}
              />
            </label>
            <label className="span-2">
              Endereço
              <input
                className="field-input"
                value={company.store_address || ''}
                onChange={(e) => setCompanyField('store_address', e.target.value)}
              />
            </label>
            <label className="span-2">
              Instagram
              <input
                className="field-input"
                value={company.store_instagram || ''}
                onChange={(e) => setCompanyField('store_instagram', e.target.value)}
              />
            </label>
            <label className="span-2">
              Mensagem do comprovante
              <input
                className="field-input"
                value={company.receipt_message || ''}
                onChange={(e) => setCompanyField('receipt_message', e.target.value)}
              />
            </label>
          </div>
          <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !isAdmin}
              onClick={() => void saveSettings('company')}
            >
              Salvar empresa
            </button>
            {!isAdmin && (
              <span className="muted-line">Somente administradores podem salvar.</span>
            )}
          </div>
        </>
      )}

      {tab === 'pdv' && (
        <>
          <div className="form-grid">
            <label>
              Terminal
              <input
                className="field-input"
                value={pdv.terminal_id || ''}
                onChange={(e) => setPdvField('terminal_id', e.target.value)}
              />
            </label>
            <label>
              Operador padrão
              <input
                className="field-input"
                value={pdv.current_operator || ''}
                onChange={(e) => setPdvField('current_operator', e.target.value)}
              />
            </label>
            <label>
              Escala da UI
              <input
                className="field-input"
                value={pdv.ui_scale || ''}
                onChange={(e) => setPdvField('ui_scale', e.target.value)}
              />
            </label>
            <label>
              Pasta de backup
              <input
                className="field-input"
                value={pdv.backup_dir || ''}
                onChange={(e) => setPdvField('backup_dir', e.target.value)}
              />
            </label>
            <label className="span-2">
              Mensagem padrão WhatsApp
              <input
                className="field-input"
                value={pdv.whatsapp_default_message || ''}
                onChange={(e) => setPdvField('whatsapp_default_message', e.target.value)}
              />
            </label>
            <label className="check-inline span-2">
              <input
                type="checkbox"
                checked={boolField(pdv.cash_require_open)}
                onChange={(e) => setPdvField('cash_require_open', e.target.checked ? '1' : '0')}
              />
              Exigir caixa aberto para vender
            </label>
            <label className="check-inline span-2">
              <input
                type="checkbox"
                checked={boolField(pdv.sale_allow_misc)}
                onChange={(e) => setPdvField('sale_allow_misc', e.target.checked ? '1' : '0')}
              />
              Permitir item diversos
            </label>
            <label className="check-inline span-2">
              <input
                type="checkbox"
                checked={boolField(pdv.print_auto_open)}
                onChange={(e) => setPdvField('print_auto_open', e.target.checked ? '1' : '0')}
              />
              Abrir comprovante automaticamente
            </label>
            <label className="check-inline span-2">
              <input
                type="checkbox"
                checked={boolField(pdv.allow_negative_stock_global)}
                onChange={(e) =>
                  setPdvField('allow_negative_stock_global', e.target.checked ? '1' : '0')
                }
              />
              Permitir estoque negativo (global)
            </label>
            {settings?.app_version ? (
              <p className="muted-line span-2">Versão do app: {settings.app_version}</p>
            ) : null}
          </div>
          <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !isAdmin}
              onClick={() => void saveSettings('pdv')}
            >
              Salvar PDV
            </button>
          </div>
        </>
      )}

      {tab === 'usuarios' && (
        <>
          {!isAdmin ? (
            <p className="cart-empty">Acesso restrito a administradores.</p>
          ) : (
            <>
              <ModuleToolbar>
                <button type="button" className="btn btn-primary" onClick={openCreateUser}>
                  Novo usuário
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void loadUsers().catch((e) => setError(e.message))}
                >
                  Atualizar
                </button>
              </ModuleToolbar>
              <div className="product-table-wrap">
                <table className="product-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Login</th>
                      <th>Perfil</th>
                      <th>Status</th>
                      <th>Último acesso</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.login}</td>
                        <td>{u.role}</td>
                        <td>
                          <StatusPill tone={u.active ? 'ok' : 'muted'}>
                            {u.active ? 'Ativo' : 'Inativo'}
                          </StatusPill>
                        </td>
                        <td>{u.last_login_at || '—'}</td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => openEditUser(u)}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={6}>Nenhum usuário.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'auditoria' && (
        <>
          {!isAdmin ? (
            <p className="cart-empty">Acesso restrito a administradores.</p>
          ) : (
            <>
              <ModuleToolbar>
                <input
                  className="search-input"
                  placeholder="Filtrar ação…"
                  value={auditAction}
                  onChange={(e) => setAuditAction(e.target.value)}
                />
                <input
                  className="search-input"
                  placeholder="Filtrar usuário…"
                  value={auditUser}
                  onChange={(e) => setAuditUser(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void loadAudit().catch((e) =>
                      setError(e instanceof Error ? e.message : 'Erro na auditoria')
                    )
                  }
                >
                  Filtrar
                </button>
              </ModuleToolbar>
              <div className="product-table-wrap">
                <table className="product-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Ação</th>
                      <th>Usuário</th>
                      <th>Entidade</th>
                      <th>Resultado</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td>{a.created_at}</td>
                        <td>{a.action}</td>
                        <td>{a.user_name || '—'}</td>
                        <td>
                          {a.entity_type || '—'}
                          {a.entity_id != null ? ` #${a.entity_id}` : ''}
                        </td>
                        <td>
                          <StatusPill
                            tone={
                              a.result === 'fail' || a.result === 'error' ? 'danger' : 'ok'
                            }
                          >
                            {a.result || 'ok'}
                          </StatusPill>
                        </td>
                        <td className="muted-line">
                          {typeof a.details === 'string'
                            ? a.details
                            : a.details
                              ? JSON.stringify(a.details)
                              : '—'}
                        </td>
                      </tr>
                    ))}
                    {audit.length === 0 && (
                      <tr>
                        <td colSpan={6}>Sem registros.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {showUserForm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{editingUser ? 'Editar usuário' : 'Novo usuário'}</h3>
            <div className="form-grid">
              <label className="span-2">
                Nome *
                <input
                  className="field-input"
                  value={userForm.name}
                  onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                />
              </label>
              <label>
                Login *
                <input
                  className="field-input"
                  value={userForm.login}
                  onChange={(e) => setUserForm({ ...userForm, login: e.target.value })}
                />
              </label>
              <label>
                Perfil
                <select
                  className="field-input"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  <option value="operador">Operador</option>
                  <option value="administrador">Administrador</option>
                </select>
              </label>
              <label className="span-2">
                {editingUser ? 'Nova senha (opcional)' : 'Senha *'}
                <input
                  className="field-input"
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                />
              </label>
              {editingUser ? (
                <label className="check-inline span-2">
                  <input
                    type="checkbox"
                    checked={userForm.active}
                    onChange={(e) => setUserForm({ ...userForm, active: e.target.checked })}
                  />
                  Ativo
                </label>
              ) : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowUserForm(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void saveUser()}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
