export type DeliveryAddressFormValue = {
  phone: string;
  zip_code: string;
  address: string;
  address_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  reference_note: string;
  notes: string;
};

type Props = {
  value: DeliveryAddressFormValue;
  onChange: (next: DeliveryAddressFormValue) => void;
  showCustomerHint?: boolean;
};

export const emptyDeliveryAddress = (): DeliveryAddressFormValue => ({
  phone: '',
  zip_code: '',
  address: '',
  address_number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  reference_note: '',
  notes: '',
});

export default function DeliveryAddressForm({ value, onChange, showCustomerHint }: Props) {
  function set<K extends keyof DeliveryAddressFormValue>(key: K, v: string) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="delivery-fields-grid">
      {showCustomerHint ? (
        <p className="muted-line span-2" style={{ margin: 0 }}>
          Endereço só deste pedido — não altera o cadastro do cliente.
        </p>
      ) : null}
      <label>
        Telefone
        <input
          className="field-input"
          value={value.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="Telefone"
        />
      </label>
      <label>
        CEP
        <input
          className="field-input"
          value={value.zip_code}
          onChange={(e) => set('zip_code', e.target.value)}
          placeholder="00000-000"
        />
      </label>
      <label className="span-2">
        Rua / Avenida
        <input
          className="field-input"
          value={value.address}
          onChange={(e) => set('address', e.target.value)}
          placeholder="Rua / Avenida"
        />
      </label>
      <label>
        Número
        <input
          className="field-input"
          value={value.address_number}
          onChange={(e) => set('address_number', e.target.value)}
          placeholder="Número"
        />
      </label>
      <label>
        Complemento
        <input
          className="field-input"
          value={value.complement}
          onChange={(e) => set('complement', e.target.value)}
          placeholder="Apto, bloco…"
        />
      </label>
      <label>
        Bairro
        <input
          className="field-input"
          value={value.neighborhood}
          onChange={(e) => set('neighborhood', e.target.value)}
          placeholder="Bairro"
        />
      </label>
      <label>
        Cidade
        <input
          className="field-input"
          value={value.city}
          onChange={(e) => set('city', e.target.value)}
          placeholder="Cidade"
        />
      </label>
      <label>
        Estado
        <input
          className="field-input"
          value={value.state}
          onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))}
          placeholder="UF"
          maxLength={2}
        />
      </label>
      <label className="span-2">
        Ponto de referência
        <input
          className="field-input"
          value={value.reference_note}
          onChange={(e) => set('reference_note', e.target.value)}
          placeholder="Ponto de referência"
        />
      </label>
      <label className="span-2">
        Observação da entrega
        <input
          className="field-input"
          value={value.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Observações"
        />
      </label>
    </div>
  );
}
