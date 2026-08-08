export interface NavItem {
  path: string;
  label: string;
  ready: boolean;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/vendas', label: 'Vendas', ready: true, description: 'PDV e finalização de vendas' },
  { path: '/caixa', label: 'Caixa', ready: false, description: 'Abertura, sangria e fechamento' },
  { path: '/produtos', label: 'Produtos', ready: false, description: 'Cadastro e preços' },
  { path: '/estoque', label: 'Estoque', ready: false, description: 'Saldos e movimentações' },
  { path: '/clientes', label: 'Clientes', ready: false, description: 'Cadastro de clientes' },
  { path: '/fornecedores', label: 'Fornecedores', ready: false, description: 'Cadastro de fornecedores' },
  { path: '/compras', label: 'Compras', ready: false, description: 'Entrada de mercadorias' },
  { path: '/crediario', label: 'Crediário', ready: false, description: 'Contas a receber' },
  { path: '/devolucoes', label: 'Devoluções', ready: false, description: 'Trocas e devoluções' },
  { path: '/relatorios', label: 'Relatórios', ready: false, description: 'Indicadores e exportações' },
  { path: '/entregas', label: 'Entregas', ready: false, description: 'Pedidos para entrega' },
  { path: '/backup', label: 'Backup', ready: false, description: 'Cópia e restauração' },
  { path: '/configuracoes', label: 'Configurações', ready: false, description: 'Preferências do sistema' },
];
