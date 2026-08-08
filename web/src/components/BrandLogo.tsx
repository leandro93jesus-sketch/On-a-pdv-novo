import { useEffect, useState } from 'react';

interface Props {
  className?: string;
  alt?: string;
  fallbackMark?: string;
  size?: number;
}

/** Exibe o logo oficial configurado; se não houver, mantém o marca-texto ON. */
export default function BrandLogo({
  className = '',
  alt = 'ONÇA Produtos de Limpeza',
  fallbackMark = 'ON',
  size = 44,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bust = Date.now();
    fetch(`/api/settings/logo/meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (cancelled) return;
        if (meta?.has_logo) {
          setSrc(`/api/settings/logo?t=${bust}`);
          setFailed(false);
        } else {
          setSrc(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (src && !failed) {
    return (
      <img
        className={`brand-logo ${className}`.trim()}
        src={src}
        alt={alt}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain' }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`brand-mark ${className}`.trim()} style={{ width: size, height: size }}>
      {fallbackMark}
    </div>
  );
}
