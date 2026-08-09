import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getAuthToken, getStoredAuthUser, loginApi } from '../../api/client';
import BrandLogo from '../../components/BrandLogo';

export default function LoginPage() {
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (getAuthToken()) {
    const user = getStoredAuthUser();
    if (user?.must_change_password) {
      return <Navigate to="/trocar-senha" replace />;
    }
    return <Navigate to="/vendas" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await loginApi(login.trim(), password);
      if (session.user?.must_change_password) {
        navigate('/trocar-senha', { replace: true });
      } else {
        navigate('/vendas', { replace: true });
      }
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
          <BrandLogo size={56} />
          <h1>ONÇA PDV</h1>
          <p>Acesso ao sistema · v1.0.0</p>
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
            autoFocus
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
          No primeiro acesso, o sistema exige a troca da senha do administrador.
        </p>
      </form>
    </div>
  );
}
