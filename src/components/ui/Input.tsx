import { forwardRef, useId, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className = '', id, ...props },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
          {props.required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <div className="relative">
        {icon && <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</div>}
        <input
          ref={ref}
          id={inputId}
          className={`field-input ${icon ? 'pl-10' : ''}`}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
      {hint && !error && <p id={`${inputId}-hint`} className="field-hint">{hint}</p>}
    </div>
  );
});

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, className = '', id, ...props }: TextareaProps) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
          {props.required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <textarea
        id={inputId}
        className="field-input"
        rows={3}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
      {error && <p className="field-error" role="alert">{error}</p>}
      {hint && !error && <p className="field-hint">{hint}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export function Select({ label, hint, error, options, className = '', id, ...props }: SelectProps) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
          {props.required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <select id={inputId} className="field-input" aria-invalid={error ? 'true' : undefined} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="field-error" role="alert">{error}</p>}
      {hint && !error && <p className="field-hint">{hint}</p>}
    </div>
  );
}
