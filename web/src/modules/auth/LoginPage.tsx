import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getAuthToken, loginApi } from '../../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const [login, setLogin] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (getAuthToken()) {
    return <Navigate to="/vendas" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginApi(login.trim(), password);
      navigate('/vendas', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
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
          <p>Acesso ao sistema</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <label>
          Usuário
          <input
            className="field-input"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
        </label>
        <label>
          Senha
          <input
            className="field-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="login-hint">
          Credenciais iniciais: <strong>admin</strong> / <strong>admin123</strong>
        </p>
      </form>
    </div>
  );
}
