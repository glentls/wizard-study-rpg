import type { ReactNode } from 'react';

export function Meter({ value, max, label, tone = 'accent', showValue = true }: { value: number; max: number; label: string; tone?: 'accent' | 'hp' | 'mana' | 'gold'; showValue?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        {showValue && (
          <span className="meter-value">
            {value} / {max}
          </span>
        )}
      </div>
      <div className={`meter-track tone-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}…
    </p>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
