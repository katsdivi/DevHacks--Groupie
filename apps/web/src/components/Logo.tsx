import { MEMBER_COLORS } from '@groupie/shared';

/** Six member colors orbiting a dot: the Groupie mark until Yug's logo lands. */
export function Logo({ size = 36 }: { size?: number }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={r} cy={r} r={r - 0.5} fill="#262626" stroke="#3A3A3A" strokeDasharray="3 3" />
      {MEMBER_COLORS.map((c, i) => {
        const a = (i / MEMBER_COLORS.length) * Math.PI * 2 - Math.PI / 2;
        return <circle key={c.name} cx={r + Math.cos(a) * r * 0.55} cy={r + Math.sin(a) * r * 0.55} r={size * 0.08} fill={c.hex} />;
      })}
      <circle cx={r} cy={r} r={size * 0.1} fill="#F5F5F5" />
    </svg>
  );
}
