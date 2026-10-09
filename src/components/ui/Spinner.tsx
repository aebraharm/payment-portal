import type { ReactNode } from 'react';
import { useAgencyName, useBranding } from '../../context/BrandingContext';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin-slow text-brand-600 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function InlineLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-500" role="status" aria-live="polite">
      <Spinner className="h-4 w-4" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Full-screen transition used between workflow steps. The message must
 * reflect the operation actually in progress.
 */
export function LoadingScreen({ message, submessage }: { message: string; submessage?: ReactNode }) {
  const agencyName = useAgencyName();
  const { logoUrl } = useBranding();
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center animate-fade-in"
      role="status"
      aria-live="polite"
    >
      {logoUrl ? (
        <img src={logoUrl} alt={agencyName} className="mb-6 h-14 w-auto rounded-xl object-contain" />
      ) : (
        <div
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-card"
          style={{ backgroundColor: 'var(--brand-primary)' }}
          aria-hidden="true"
        >
          {agencyName.charAt(0).toUpperCase()}
        </div>
      )}
      <Spinner className="h-9 w-9" />
      <p className="mt-5 text-base font-semibold text-navy-800">{message}</p>
      {submessage && <div className="mt-2 max-w-md text-sm text-slate-500">{submessage}</div>}
    </div>
  );
}

/** Compact page-level loading placeholder. */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <InlineLoader label={label} />
    </div>
  );
}
