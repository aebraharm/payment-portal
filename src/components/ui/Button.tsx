import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { IconRefresh } from './Icons';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, loadingText, className = '', children, disabled, ...props },
  ref
) {
  const sizeClass = size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : '';
  return (
    <button
      ref={ref}
      className={`btn btn-${variant} ${sizeClass} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <IconRefresh className="h-4 w-4 animate-spin-slow" />}
      {loading ? loadingText || children : children}
    </button>
  );
});
