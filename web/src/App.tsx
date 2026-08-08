import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import { getAuthToken, getStoredAuthUser } from './api/client';
import VendasPage from './modules/vendas/VendasPage';
import ProdutosPage from './modules/produtos/ProdutosPage';
import EstoquePage from './modules/estoque/EstoquePage';
import CaixaPage from './modules/caixa/CaixaPage';
import ClientesPage from './modules/clientes/ClientesPage';
import FornecedoresPage from './modules/fornecedores/FornecedoresPage';
import ComprasPage from './modules/compras/ComprasPage';
import CrediarioPage from './modules/crediario/CrediarioPage';
import DevolucoesPage from './modules/devolucoes/DevolucoesPage';
import EntregasPage from './modules/entregas/EntregasPage';
import RelatoriosPage from './modules/relatorios/RelatoriosPage';
import BackupPage from './modules/backup/BackupPage';
import ConfiguracoesPage from './modules/configuracoes/ConfiguracoesPage';
import LoginPage from './modules/auth/LoginPage';
import ChangePasswordPage from './modules/auth/ChangePasswordPage';

function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (location.pathname === '/login') return <>{children}</>;
  if (!getAuthToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  const user = getStoredAuthUser();
  if (user?.must_change_password && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/vendas" replace />} />
          <Route path="/vendas" element={<VendasPage />} />
          <Route path="/caixa" element={<CaixaPage />} />
          <Route path="/produtos" element={<ProdutosPage />} />
          <Route path="/estoque" element={<EstoquePage />} />
          <Route path="/clientes" element={<ClientesPage />} />
          <Route path="/fornecedores" element={<FornecedoresPage />} />
          <Route path="/compras" element={<ComprasPage />} />
          <Route path="/crediario" element={<CrediarioPage />} />
          <Route path="/devolucoes" element={<DevolucoesPage />} />
          <Route path="/relatorios" element={<RelatoriosPage />} />
          <Route path="/entregas" element={<EntregasPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          <Route path="*" element={<Navigate to="/vendas" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
