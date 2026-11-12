import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  children,
  onClose,
  className = '',
  labelledBy,
}: {
  title?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, button:not([disabled])');
    first?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal parchment ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? 'modal-title'}>
        {title && (
          <h2 id="modal-title" className="modal__title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

export function Bar({ value, max, className = '', label }: { value: number; max: number; className?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn btn--ghost back-btn" onClick={onClick}>
      <span aria-hidden="true">←</span> {label}
    </button>
  );
}
