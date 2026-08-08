import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePasswordApi, getStoredAuth, setAuthSession } from '../../api/client';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const auth = getStoredAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('A nova senha deve ter ao menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirm) {
      setError('A confirmação não confere.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await changePasswordApi({
        current_password: currentPassword,
        new_password: newPassword,
      });
      if (auth) {
        setAuthSession({ ...auth, user: { ...auth.user, ...user, must_change_password: 0 } });
      }
      navigate('/vendas', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar senha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="login-brand">
          <div className="brand-mark">ON</div>
          <h1>ONÇA PDV</h1>
          <p>Defina uma senha segura</p>
        </div>
        <div className="alert alert-ok" style={{ marginBottom: 12 }}>
          Por segurança, troque a senha inicial antes de continuar.
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <label>
          Senha atual
          <input
            className="field-input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <label>
          Nova senha
          <input
            className="field-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirmar nova senha
          <input
            className="field-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar e continuar'}
        </button>
      </form>
    </div>
  );
}
