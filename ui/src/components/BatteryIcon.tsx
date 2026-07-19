import { Status } from '../lib/api';

interface Props {
  status: Status | null;
  size?: number; // px
}

// SVG battery icon that mirrors status.pct + status.charging.
// Color tiers: <20% red, <50% orange, otherwise green.
export function BatteryIcon({ status, size = 80 }: Props) {
  const pct = status?.pct ?? 0;
  const charging = status?.charging ?? false;
  const fillColor =
    pct < 20 ? 'var(--bad)' : pct < 50 ? 'var(--warn)' : 'var(--good)';
  const w = size;
  const h = Math.round(size * 0.5);
  const tipW = Math.round(size * 0.05);
  const tipH = Math.round(h * 0.45);
  const pad = Math.round(size * 0.04);
  const bodyX = pad;
  const bodyY = pad;
  const bodyW = w - pad * 2 - tipW;
  const bodyH = h - pad * 2;
  const innerPad = Math.round(size * 0.04);
  const innerX = bodyX + innerPad;
  const innerY = bodyY + innerPad;
  const innerW = bodyW - innerPad * 2;
  const innerH = bodyH - innerPad * 2;
  const fillW = Math.max(0, Math.round((innerW * pct) / 100));

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-label={`Battery ${pct}%${charging ? ' charging' : ''}`}
      role="img"
    >
      {/* tip */}
      <rect
        x={w - pad - tipW}
        y={(h - tipH) / 2}
        width={tipW}
        height={tipH}
        rx="1"
        fill="var(--muted)"
        opacity={0.4}
      />
      {/* body outline */}
      <rect
        x={bodyX}
        y={bodyY}
        width={bodyW}
        height={bodyH}
        rx={Math.round(size * 0.06)}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="1.5"
        opacity={0.5}
      />
      {/* fill */}
      <rect
        x={innerX}
        y={innerY}
        width={fillW}
        height={innerH}
        rx={Math.round(size * 0.04)}
        fill={fillColor}
        opacity={charging ? 0.85 : 1}
      />
      {/* charging lightning bolt */}
      {charging && pct < 100 && (
        <path
          d={`M ${w * 0.45} ${h * 0.25} L ${w * 0.40} ${h * 0.55} L ${w * 0.50} ${h * 0.55} L ${w * 0.45} ${h * 0.75} L ${w * 0.55} ${h * 0.40} L ${w * 0.45} ${h * 0.40} Z`}
          fill="white"
        />
      )}
    </svg>
  );
}