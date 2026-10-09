import { useRef, useState } from 'react';
import { IconFile, IconUpload, IconX } from './Icons';
import { formatBytes } from '../../lib/format';

interface FileUploadProps {
  label?: string;
  hint?: string;
  error?: string;
  accept?: string; // e.g. ".pdf,.jpg,.png"
  maxSizeMb?: number;
  value: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
}

export function FileUpload({
  label = 'Upload file',
  hint,
  error,
  accept = '.pdf,.jpg,.jpeg,.png',
  maxSizeMb = 10,
  value,
  onChange,
  required,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const validate = (file: File): string | null => {
    const allowedExts = accept.split(',').map((s) => s.trim().toLowerCase());
    const name = file.name.toLowerCase();
    const hasAllowedExt = allowedExts.some((ext) => name.endsWith(ext));
    if (!hasAllowedExt) {
      return `File type not allowed. Accepted types: ${accept}`;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      return `File is larger than ${maxSizeMb} MB.`;
    }
    return null;
  };

  const handleFile = (file: File | null) => {
    if (!file) {
      onChange(null);
      setLocalError(null);
      return;
    }
    const err = validate(file);
    setLocalError(err);
    onChange(err ? null : file);
  };

  const displayError = error || localError;

  return (
    <div>
      {label && (
        <span className="field-label">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </span>
      )}
      <div
        className={`mt-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragOver ? 'border-brand-400 bg-brand-50' : displayError ? 'border-red-300 bg-red-50/40' : 'border-slate-300 hover:border-brand-300'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0] || null);
        }}
      >
        {value ? (
          <div className="flex items-center justify-center gap-3">
            <IconFile className="h-6 w-6 text-brand-600" />
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-medium text-navy-900">{value.name}</p>
              <p className="text-xs text-slate-500">{formatBytes(value.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => handleFile(null)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
              aria-label="Remove file"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mx-auto flex flex-col items-center gap-2 text-slate-500"
          >
            <IconUpload className="h-7 w-7 text-brand-500" />
            <span className="text-sm font-medium text-navy-700">Click to upload or drag and drop</span>
            <span className="text-xs text-slate-400">
              {accept.replace(/\./g, '').toUpperCase().replace(/,/g, ', ')} up to {maxSizeMb} MB
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
        />
      </div>
      {displayError && <p className="field-error" role="alert">{displayError}</p>}
      {hint && !displayError && <p className="field-hint">{hint}</p>}
    </div>
  );
}
