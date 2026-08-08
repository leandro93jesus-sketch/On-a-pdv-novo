import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import PlaceholderModule from './modules/PlaceholderModule';
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

export default function App() {
  return (
    <Routes>
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
        <Route path="/relatorios" element={<PlaceholderModule />} />
        <Route path="/entregas" element={<EntregasPage />} />
        <Route path="/backup" element={<PlaceholderModule />} />
        <Route path="/configuracoes" element={<PlaceholderModule />} />
        <Route path="*" element={<Navigate to="/vendas" replace />} />
      </Route>
    </Routes>
  );
}
