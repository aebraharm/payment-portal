import { IconCheck } from './Icons';

export interface StepperStep {
  label: string;
  description?: string;
}

export function Stepper({ steps, current }: { steps: StepperStep[]; current: number }) {
  return (
    <nav aria-label="Progress" className="w-full">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
          return (
            <li key={step.label} className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}>
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors ${
                    state === 'done'
                      ? 'border-transparent text-white'
                      : state === 'current'
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-300 bg-white text-slate-400'
                  }`}
                  style={state === 'done' ? { backgroundColor: 'var(--brand-primary)' } : undefined}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  {state === 'done' ? <IconCheck className="h-4 w-4" /> : index + 1}
                </span>
                <span
                  className={`hidden text-center text-xs font-medium sm:block ${
                    state === 'current' ? 'text-navy-900' : state === 'done' ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-2 mb-0 h-0.5 flex-1 sm:mb-5 ${
                    index < current ? '' : 'bg-slate-200'
                  }`}
                  style={index < current ? { backgroundColor: 'var(--brand-primary)' } : undefined}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
