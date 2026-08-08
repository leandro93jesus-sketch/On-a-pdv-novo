import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../navigation';

function titleForPath(pathname: string) {
  const item = NAV_ITEMS.find((n) => n.path === pathname);
  return item ?? NAV_ITEMS[0];
}

export default function AppShell() {
  const location = useLocation();
  const current = titleForPath(location.pathname);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">ON</div>
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
          Etapa 3 · Fornecedores, Compras, Crediário, Devoluções e Entregas
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
