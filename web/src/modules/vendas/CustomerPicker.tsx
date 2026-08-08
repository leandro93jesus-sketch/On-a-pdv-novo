import { useEffect, useState } from 'react';
import { createCustomer, fetchCustomers, type Customer } from '../../api/client';

interface Props {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
}

export default function CustomerPicker({ selected, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(async () => {
      try {
        setResults(await fetchCustomers({ q: q.trim() || undefined }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro na busca');
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [q, open]);

  async function quickCreate() {
    if (!quickName.trim()) return;
    try {
      const c = await createCustomer({ name: quickName.trim() });
      onSelect(c);
      setQuickName('');
      setOpen(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cadastrar');
    }
  }

  return (
    <div className="customer-bar">
      <div className="customer-current">
        <span>Cliente:</span>
        <strong>{selected ? selected.name : 'Consumidor não identificado'}</strong>
        {selected && (
          <button type="button" className="btn btn-ghost" onClick={() => onSelect(null)}>
            Remover
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Selecionar / cadastrar
        </button>
      </div>

      {open && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Cliente da venda</h3>
            <p>Busque um cliente existente ou cadastre rapidamente sem sair da venda.</p>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-fields">
              <label>
                Buscar
                <input
                  className="field-input"
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Nome, telefone ou documento"
                />
              </label>
            </div>
            <ul className="picker-list">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(c);
                      setOpen(false);
                    }}
                  >
                    <strong>{c.name}</strong>
                    <span>{c.phone || c.document || 'Sem contato'}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal-fields">
              <label>
                Cadastro rápido (nome)
                <input
                  className="field-input"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="Nome do cliente"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Fechar
              </button>
              <button type="button" className="btn btn-accent" onClick={() => void quickCreate()}>
                Cadastrar e usar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
