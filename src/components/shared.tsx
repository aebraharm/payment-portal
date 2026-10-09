import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  breadcrumbs?: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">/</span>}
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-brand-600">{crumb.label}</Link>
              ) : (
                <span className="font-medium text-navy-700">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'warning' | 'success' | 'danger';
}) {
  const toneRing =
    tone === 'warning'
      ? 'bg-amber-50 text-amber-600'
      : tone === 'success'
        ? 'bg-green-50 text-green-600'
        : tone === 'danger'
          ? 'bg-red-50 text-red-600'
          : 'bg-brand-50';
  const toneText = tone === 'default' ? '' : '';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className={`mt-1 truncate text-2xl font-bold text-navy-900 ${toneText}`}>{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        {icon && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneRing}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple responsive table wrapper with horizontal scroll on small screens. */
export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      <div className="overflow-x-auto thin-scrollbar">
        <table className="w-full text-left text-sm">{children}</table>
      </div>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
      {children}
    </thead>
  );
}

export function TableRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      className={`border-b border-slate-50 last:border-0 ${onClick ? 'cursor-pointer transition-colors hover:bg-brand-50/40' : ''}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-semibold ${className}`}>{children}</th>;
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle text-slate-700 ${className}`}>{children}</td>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="search"
      className="field-input"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
    />
  );
}
