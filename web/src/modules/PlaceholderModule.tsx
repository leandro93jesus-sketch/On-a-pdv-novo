import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../navigation';

export default function PlaceholderModule() {
  const { pathname } = useLocation();
  const item = NAV_ITEMS.find((n) => n.path === pathname);

  return (
    <section className="placeholder-panel">
      <h3>{item?.label ?? 'Módulo'}</h3>
      <p>
        {item?.description ?? 'Área do sistema'}. Esta área faz parte da navegação do ONÇA PDV e
        será implementada nas próximas etapas. Nesta etapa, o foco é o módulo de <strong>Vendas</strong>.
      </p>
      <span className="badge">Planejado para etapa seguinte</span>
    </section>
  );
}
