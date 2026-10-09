/** Lightweight SVG charts — no external charting dependency. */

export function BarChart({
  data,
  height = 180,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = 100 / Math.max(1, data.length);
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }} role="img" aria-label="Bar chart">
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 24);
          const x = i * barWidth + barWidth * 0.18;
          const w = barWidth * 0.64;
          return (
            <g key={d.label}>
              <rect
                x={x}
                y={height - 20 - h}
                width={w}
                height={h}
                rx={1.5}
                fill={d.color || 'var(--brand-primary)'}
                className="transition-opacity hover:opacity-80"
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between gap-1">
        {data.map((d) => (
          <div key={d.label} className="flex-1 truncate text-center text-[10px] text-slate-500 sm:text-xs">
            <div className="truncate">{d.label}</div>
            <div className="font-semibold text-slate-700">{d.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PALETTE = ['#2563eb', '#0b2447', '#38bdf8', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6'];

export function DonutChart({
  data,
  size = 180,
  thickness = 26,
  centerLabel,
  centerValue,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = data.map((d, i) => {
    const fraction = total > 0 ? d.value / total : 0;
    const dash = fraction * circumference;
    const segment = {
      ...d,
      color: d.color || PALETTE[i % PALETTE.length],
      dash,
      offset,
    };
    offset += dash;
    return segment;
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Breakdown chart">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef2f7" strokeWidth={thickness} />
        {segments.map((s) => (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          >
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="fill-navy-900" fontSize={size * 0.13} fontWeight={700}>
          {centerValue ?? total}
        </text>
        {centerLabel && (
          <text x="50%" y="58%" textAnchor="middle" className="fill-slate-400" fontSize={size * 0.065}>
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="w-full space-y-2">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color || PALETTE[i % PALETTE.length] }} />
              {d.label}
            </span>
            <span className="font-semibold text-navy-900">{d.value}</span>
          </li>
        ))}
        {total === 0 && <li className="text-sm text-slate-400">No data yet</li>}
      </ul>
    </div>
  );
}

export function LineChart({
  data,
  height = 160,
  color = 'var(--brand-primary)',
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No activity in the last 14 days.</p>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 100;
  const H = height;
  const pad = 6;
  const step = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = pad + i * step;
    const y = H - pad - (d.value / max) * (H - pad * 2);
    return { x, y };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label="Activity chart">
        <path d={areaPath} fill={color} opacity={0.08} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.6} fill={color}>
            <title>{`${data[i].label}: ${data[i].value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400 sm:text-xs">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
