import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import PlaceholderModule from './modules/PlaceholderModule';
import VendasPage from './modules/vendas/VendasPage';
import ProdutosPage from './modules/produtos/ProdutosPage';
import EstoquePage from './modules/estoque/EstoquePage';
import CaixaPage from './modules/caixa/CaixaPage';
import ClientesPage from './modules/clientes/ClientesPage';

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
        <Route path="/fornecedores" element={<PlaceholderModule />} />
        <Route path="/compras" element={<PlaceholderModule />} />
        <Route path="/crediario" element={<PlaceholderModule />} />
        <Route path="/devolucoes" element={<PlaceholderModule />} />
        <Route path="/relatorios" element={<PlaceholderModule />} />
        <Route path="/entregas" element={<PlaceholderModule />} />
        <Route path="/backup" element={<PlaceholderModule />} />
        <Route path="/configuracoes" element={<PlaceholderModule />} />
        <Route path="*" element={<Navigate to="/vendas" replace />} />
      </Route>
    </Routes>
  );
}
