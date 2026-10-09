import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo, IconX } from './Icons';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, { wrap: string; icon: ReactNode; title: string }> = {
  info: {
    wrap: 'border-blue-200 bg-blue-50 text-blue-900',
    icon: <IconInfo className="h-5 w-5 text-blue-500" />,
    title: 'Information',
  },
  success: {
    wrap: 'border-green-200 bg-green-50 text-green-900',
    icon: <IconCheck className="h-5 w-5 text-green-500" />,
    title: 'Success',
  },
  warning: {
    wrap: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: <IconAlert className="h-5 w-5 text-amber-500" />,
    title: 'Attention',
  },
  error: {
    wrap: 'border-red-200 bg-red-50 text-red-900',
    icon: <IconX className="h-5 w-5 text-red-500" />,
    title: 'Error',
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className = '',
  onDismiss,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  onDismiss?: () => void;
}) {
  const t = TONES[tone];
  return (
    <div role="alert" className={`flex gap-3 rounded-xl border p-4 ${t.wrap} ${className}`}>
      <div className="shrink-0">{t.icon}</div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{title || t.title}</p>
        {children && <div className="mt-1 leading-relaxed">{children}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 transition-opacity hover:opacity-100" aria-label="Dismiss">
          <IconX className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
