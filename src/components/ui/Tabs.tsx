export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export function Tabs({ tabs, active, onChange, className = '' }: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={`border-b border-slate-200 ${className}`} role="tablist">
      <nav className="-mb-px flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
              style={isActive ? { borderColor: 'var(--brand-primary)', color: 'var(--brand-primary-dark)' } : undefined}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
