import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../navigation';
import { clearAuth, getStoredAuthUser, logoutApi } from '../api/client';
import BrandLogo from '../components/BrandLogo';

function titleForPath(pathname: string) {
  const item = NAV_ITEMS.find((n) => n.path === pathname);
  return item ?? NAV_ITEMS[0];
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = titleForPath(location.pathname);
  const user = getStoredAuthUser();

  async function handleLogout() {
    try {
      await logoutApi();
    } catch {
      /* limpa sessão local mesmo se a API falhar */
    }
    clearAuth();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <BrandLogo size={48} />
          <h1>ONÇA PDV</h1>
          <p>Ponto de Venda</p>
        </div>

        <nav className="nav-list" aria-label="Módulos">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <span>{item.label}</span>
              {!item.ready && <span className="soon">Em breve</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-version">ONÇA PDV 1.2.5</div>
          {user ? (
            <div className="sidebar-user">
              <span title={user.role}>{user.name || user.login}</span>
              <button
                type="button"
                className="btn btn-ghost sidebar-logout"
                onClick={() => void handleLogout()}
              >
                Sair
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div>
            <h2>{current.label}</h2>
            <p>{current.description}</p>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
