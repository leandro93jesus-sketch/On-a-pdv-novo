import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import PlaceholderModule from './modules/PlaceholderModule';
import VendasPage from './modules/vendas/VendasPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/vendas" replace />} />
        <Route path="/vendas" element={<VendasPage />} />
        <Route path="/caixa" element={<PlaceholderModule />} />
        <Route path="/produtos" element={<PlaceholderModule />} />
        <Route path="/estoque" element={<PlaceholderModule />} />
        <Route path="/clientes" element={<PlaceholderModule />} />
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
