import { useAgencyName, useBranding } from '../../context/BrandingContext';

/** Agency logo with a neutral placeholder when no logo is configured. */
export function BrandLogo({ size = 'md', showName = true, className = '' }: {
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
}) {
  const { logoUrl } = useBranding();
  const agencyName = useAgencyName();
  const dims = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {logoUrl ? (
        <img src={logoUrl} alt={agencyName} className={`${dims} rounded-xl object-contain`} />
      ) : (
        <div
          className={`${dims} flex shrink-0 items-center justify-center rounded-xl font-bold text-white shadow-sm`}
          style={{ backgroundColor: 'var(--brand-primary)' }}
          aria-hidden="true"
        >
          {agencyName.charAt(0).toUpperCase()}
        </div>
      )}
      {showName && (
        <span className={`font-bold tracking-tight text-navy-900 ${textSize}`}>{agencyName}</span>
      )}
    </div>
  );
}
