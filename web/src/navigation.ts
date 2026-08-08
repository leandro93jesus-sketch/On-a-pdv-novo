export interface NavItem {
  path: string;
  label: string;
  ready: boolean;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/vendas', label: 'Vendas', ready: true, description: 'PDV e finalização de vendas' },
  { path: '/caixa', label: 'Caixa', ready: true, description: 'Abertura, sangria e fechamento' },
  { path: '/produtos', label: 'Produtos', ready: true, description: 'Cadastro e preços' },
  { path: '/estoque', label: 'Estoque', ready: true, description: 'Saldos e movimentações' },
  { path: '/clientes', label: 'Clientes', ready: true, description: 'Cadastro de clientes' },
  { path: '/fornecedores', label: 'Fornecedores', ready: true, description: 'Cadastro de fornecedores' },
  { path: '/compras', label: 'Compras', ready: true, description: 'Entrada de mercadorias' },
  { path: '/crediario', label: 'Crediário', ready: true, description: 'Contas a receber' },
  { path: '/devolucoes', label: 'Devoluções', ready: true, description: 'Trocas e devoluções' },
  { path: '/relatorios', label: 'Relatórios', ready: true, description: 'Vendas, estoque e indicadores' },
  { path: '/entregas', label: 'Entregas', ready: true, description: 'Pedidos para entrega' },
  { path: '/backup', label: 'Backup', ready: true, description: 'Cópia, restauração e importação' },
  { path: '/configuracoes', label: 'Configurações', ready: true, description: 'Empresa, PDV, usuários e auditoria' },
];
