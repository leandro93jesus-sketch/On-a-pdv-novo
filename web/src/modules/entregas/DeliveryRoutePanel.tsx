import { useState } from 'react';
import {
  deliveryOrderWhatsAppShareApi,
  logDeliveryOrderRouteEventApi,
  updateDeliveryOrderAddressApi,
  type DeliveryOrder,
} from '../../api/client';
import DeliveryAddressForm, {
  emptyDeliveryAddress,
  type DeliveryAddressFormValue,
} from './DeliveryAddressForm';
import {
  buildDeliveryRouteWhatsAppMessage,
  buildGoogleMapsSearchUrl,
  copyText,
  formatDeliveryAddressOneLine,
  isDeliveryAddressComplete,
} from './deliveryAddress';

type Props = {
  order: DeliveryOrder;
  onOrderUpdated: (order: DeliveryOrder) => void;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function DeliveryRoutePanel({ order, onOrderUpdated, onNotice, onError }: Props) {
  const [showFixAddress, setShowFixAddress] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareTarget, setShareTarget] = useState<'cliente' | 'entregador' | 'outro'>('cliente');
  const [manualPhone, setManualPhone] = useState('');
  const [courierPhoneDraft, setCourierPhoneDraft] = useState(order.courier_phone || '');
  const [addrDraft, setAddrDraft] = useState<DeliveryAddressFormValue>(emptyDeliveryAddress());

  const complete = isDeliveryAddressComplete(order);
  const mapUrl = buildGoogleMapsSearchUrl(order);

  function openFix() {
    setAddrDraft({
      phone: order.phone || '',
      zip_code: order.zip_code || '',
      address: order.address || '',
      address_number: order.address_number || '',
      complement: order.complement || '',
      neighborhood: order.neighborhood || '',
      city: order.city || '',
      state: order.state || '',
      reference_note: order.reference_note || '',
      notes: order.notes || '',
    });
    setShowFixAddress(true);
  }

  async function saveAddress() {
    if (!isDeliveryAddressComplete(addrDraft)) {
      onError('ENDEREÇO INCOMPLETO PARA GERAR ROTA. Informe rua, número e cidade.');
      return;
    }
    try {
      const updated = await updateDeliveryOrderAddressApi(order.id, {
        phone: addrDraft.phone.trim() || null,
        zip_code: addrDraft.zip_code.trim() || null,
        address: addrDraft.address.trim(),
        address_number: addrDraft.address_number.trim(),
        complement: addrDraft.complement.trim() || null,
        neighborhood: addrDraft.neighborhood.trim() || null,
        city: addrDraft.city.trim(),
        state: addrDraft.state.trim() || null,
        reference_note: addrDraft.reference_note.trim() || null,
        notes: addrDraft.notes.trim() || null,
      });
      onOrderUpdated(updated);
      setShowFixAddress(false);
      onNotice('Endereço do pedido atualizado (cadastro do cliente não foi alterado).');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Erro ao corrigir endereço');
    }
  }

  async function copyAddress() {
    const text = [
      'ENDEREÇO DE ENTREGA',
      `Rua: ${order.address || '—'}`,
      `Número: ${order.address_number || '—'}`,
      `Complemento: ${order.complement || '—'}`,
      `Bairro: ${order.neighborhood || '—'}`,
      `Cidade/UF: ${[order.city, order.state].filter(Boolean).join('/') || '—'}`,
      `CEP: ${order.zip_code || '—'}`,
      `Referência: ${order.reference_note || '—'}`,
    ].join('\n');
    const ok = await copyText(text);
    if (!ok) {
      onError('Não foi possível copiar o endereço');
      return;
    }
    try {
      onOrderUpdated(await logDeliveryOrderRouteEventApi(order.id, { event: 'address_copied' }));
    } catch {
      /* histórico opcional */
    }
    onNotice('Endereço copiado.');
  }

  async function copyRouteLink() {
    if (!mapUrl) {
      onError('ENDEREÇO INCOMPLETO PARA GERAR ROTA.');
      setShowFixAddress(true);
      return;
    }
    const ok = await copyText(mapUrl);
    if (!ok) {
      onError('Não foi possível copiar o link');
      return;
    }
    try {
      onOrderUpdated(await logDeliveryOrderRouteEventApi(order.id, { event: 'route_link_copied' }));
    } catch {
      /* histórico opcional */
    }
    onNotice('Link da rota copiado.');
  }

  async function openRoute() {
    if (!mapUrl) {
      onError('ENDEREÇO INCOMPLETO PARA GERAR ROTA.');
      openFix();
      return;
    }
    window.open(mapUrl, '_blank', 'noopener,noreferrer');
    try {
      onOrderUpdated(await logDeliveryOrderRouteEventApi(order.id, { event: 'route_opened' }));
    } catch {
      /* histórico opcional */
    }
    onNotice('Rota aberta no mapa. Isso não confirma pagamento.');
  }

  function resolveSharePhone(): string {
    if (shareTarget === 'cliente') return order.phone || '';
    if (shareTarget === 'entregador') return courierPhoneDraft.trim() || order.courier_phone || '';
    return manualPhone.trim();
  }

  async function shareWhatsApp() {
    if (!mapUrl) {
      onError('ENDEREÇO INCOMPLETO PARA GERAR ROTA.');
      openFix();
      return;
    }
    const phone = resolveSharePhone();
    if (shareTarget !== 'cliente' && !phone) {
      onError('Informe o telefone do destinatário.');
      return;
    }
    const message = buildDeliveryRouteWhatsAppMessage(order, mapUrl);
    try {
      if (shareTarget === 'entregador' && courierPhoneDraft.trim()) {
        await updateDeliveryOrderAddressApi(order.id, {
          courier_phone: courierPhoneDraft.trim(),
          address: order.address,
          address_number: order.address_number,
          city: order.city,
          phone: order.phone,
          complement: order.complement,
          neighborhood: order.neighborhood,
          state: order.state,
          zip_code: order.zip_code,
          reference_note: order.reference_note,
          notes: order.notes,
        });
      }
      const share = await deliveryOrderWhatsAppShareApi(order.id, {
        phone: phone || undefined,
        message,
        recipient: shareTarget,
      });
      if (share.order) onOrderUpdated(share.order);
      window.open(share.url, '_blank', 'noopener,noreferrer');
      setShowShare(false);
      onNotice('WhatsApp aberto com a rota. Compartilhar NÃO confirma pagamento nem entra no caixa.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Erro ao compartilhar no WhatsApp');
    }
  }

  return (
    <div className="delivery-address-card">
      <h4 style={{ marginTop: 0 }}>ENDEREÇO DE ENTREGA</h4>
      {!complete ? (
        <div className="alert alert-error">
          <strong>ENDEREÇO INCOMPLETO PARA GERAR ROTA.</strong>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" onClick={openFix}>
              CORRIGIR ENDEREÇO
            </button>
          </div>
        </div>
      ) : (
        <div className="delivery-address-lines">
          <div>
            <span>Rua:</span> <strong>{order.address || '—'}</strong>
          </div>
          <div>
            <span>Número:</span> <strong>{order.address_number || '—'}</strong>
          </div>
          <div>
            <span>Complemento:</span> <strong>{order.complement || '—'}</strong>
          </div>
          <div>
            <span>Bairro:</span> <strong>{order.neighborhood || '—'}</strong>
          </div>
          <div>
            <span>Cidade/UF:</span>{' '}
            <strong>{[order.city, order.state].filter(Boolean).join('/') || '—'}</strong>
          </div>
          <div>
            <span>CEP:</span> <strong>{order.zip_code || '—'}</strong>
          </div>
          <div>
            <span>Referência:</span> <strong>{order.reference_note || '—'}</strong>
          </div>
          <p className="muted-line" style={{ marginTop: 8 }}>
            {formatDeliveryAddressOneLine(order)}
          </p>
        </div>
      )}

      <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" onClick={() => void copyAddress()}>
          COPIAR ENDEREÇO
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void copyRouteLink()}>
          COPIAR LINK DA ROTA
        </button>
        <button type="button" className="btn btn-accent" onClick={() => void openRoute()}>
          ABRIR ROTA
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (!complete) {
              onError('ENDEREÇO INCOMPLETO PARA GERAR ROTA.');
              openFix();
              return;
            }
            setShareTarget('cliente');
            setManualPhone('');
            setCourierPhoneDraft(order.courier_phone || '');
            setShowShare(true);
          }}
        >
          COMPARTILHAR ROTA NO WHATSAPP
        </button>
        <button type="button" className="btn btn-ghost" onClick={openFix}>
          CORRIGIR ENDEREÇO
        </button>
      </div>

      {showFixAddress && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Corrigir endereço do pedido</h2>
            <p className="muted-line">Altera só este pedido. Não muda o cadastro do cliente.</p>
            <DeliveryAddressForm value={addrDraft} onChange={setAddrDraft} />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowFixAddress(false)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveAddress()}>
                Salvar endereço
              </button>
            </div>
          </div>
        </div>
      )}

      {showShare && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Compartilhar rota no WhatsApp</h2>
            <p className="muted-line">
              Disponível mesmo em AGUARDANDO PAGAMENTO. Não confirma pagamento nem entra no caixa.
            </p>
            <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={shareTarget === 'cliente' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setShareTarget('cliente')}
              >
                ENVIAR PARA CLIENTE
              </button>
              <button
                type="button"
                className={shareTarget === 'entregador' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setShareTarget('entregador')}
              >
                ENVIAR PARA ENTREGADOR
              </button>
              <button
                type="button"
                className={shareTarget === 'outro' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setShareTarget('outro')}
              >
                INFORMAR OUTRO NÚMERO
              </button>
            </div>
            {shareTarget === 'cliente' && (
              <p>
                Telefone do pedido: <strong>{order.phone || 'não informado (abrirá sem número)'}</strong>
              </p>
            )}
            {shareTarget === 'entregador' && (
              <label>
                Telefone do entregador
                <input
                  className="field-input"
                  value={courierPhoneDraft}
                  onChange={(e) => setCourierPhoneDraft(e.target.value)}
                  placeholder="Digite se não houver cadastrado"
                />
              </label>
            )}
            {shareTarget === 'outro' && (
              <label>
                Outro número
                <input
                  className="field-input"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="DDD + número"
                />
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowShare(false)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void shareWhatsApp()}>
                Abrir WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
