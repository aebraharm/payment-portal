export { formatMoney } from '../../shared/money';
export { formatIsoDate, formatDateTime } from '../../shared/dates';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted';

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200',
  muted: 'bg-slate-50 text-slate-500 ring-slate-200',
};

export function sentence(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
