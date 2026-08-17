import { useState, type FormEvent } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onAuthorized: (data: { password: string; reason: string }) => void | Promise<void>;
};

/**
 * Autorização administrativa com campo password (nunca exibe a senha).
 * A senha não é logada nem enviada para UI de auditoria textual.
 */
export default function AdminAuthModal({
  title,
  subtitle,
  requireReason = true,
  reasonLabel = 'MOTIVO',
  confirmLabel = 'AUTORIZAR',
  onCancel,
  onAuthorized,
}: Props) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Informe a senha administrativa.');
      return;
    }
    if (requireReason && !reason.trim()) {
      setError('Informe o motivo.');
      return;
    }
    setBusy(true);
    try {
      await onAuthorized({ password, reason: reason.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autorização');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Autorização administrativa">
      <div className="modal">
        <h3>AUTORIZAÇÃO ADMINISTRATIVA</h3>
        <p className="muted-line">{title}</p>
        {subtitle ? <p className="muted-line">{subtitle}</p> : null}
        <form onSubmit={(e) => void submit(e)}>
          <label>
            Senha
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          {requireReason && (
            <label style={{ display: 'block', marginTop: 10 }}>
              {reasonLabel}
              <textarea
                className="field-input"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Descreva o motivo…"
              />
            </label>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              CANCELAR
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Validando…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
