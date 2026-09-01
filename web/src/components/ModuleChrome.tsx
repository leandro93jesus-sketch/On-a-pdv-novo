import type { InputHTMLAttributes, ReactNode } from 'react';

export function ModuleToolbar({ children }: { children: ReactNode }) {
  return <div className="module-toolbar">{children}</div>;
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info';
  children: ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="field-input" inputMode="decimal" {...props} />;
}
