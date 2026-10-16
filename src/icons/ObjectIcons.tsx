import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { squircle } from './squircle';

/**
 * Mochi's own concepts as small lit objects, like `DeviceIcon`: each shape is a solid with a darker extruded side, a body
 * lit from the top-left in one colour, an edge that holds on a light page, a white sheen and a soft contact shadow. Fixed
 * materials, the same in both themes.
 */

/** A skill is know-how the agent loads: a lit yellow bulb on a metal base. */
export function SkillIcon({ className }: { className?: string }) {
  return (
    <LitObject className={className}>
      <Solid d="M9.3 16.2C9.3 14 5.2 12.6 5.2 9.2a6.8 6.8 0 0 1 13.6 0c0 3.4-4.1 4.8-4.1 7z" material={MATERIALS.bulb} />
      <path d="M10.2 12.4l.9-2.2 1.1 2 1-2 .9 2.2" fill="none" stroke={MATERIALS.bulb.edge} strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" />
      <Solid d={squircle(9.1, 16.2, 5.8, 4, 1)} material={MATERIALS.steel} />
      <path d="M9.4 17.6h5.2M9.4 19h5.2" stroke={MATERIALS.steel.edge} strokeWidth="0.5" />
    </LitObject>
  );
}

/** A plugin adds a piece: a mint puzzle piece with depth. */
export function PluginIcon({ className }: { className?: string }) {
  return (
    <LitObject className={className}>
      <g transform="translate(1.2 0)">
        <Solid d="M5.5 8H8.4a2.3 2.3 0 1 1 3.6 0H15a1.5 1.5 0 0 1 1.5 1.5V12a2.3 2.3 0 1 1 0 3.6V18a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18V9.5A1.5 1.5 0 0 1 5.5 8Z" material={MATERIALS.plugin} />
      </g>
    </LitObject>
  );
}

/** An MCP server is tools the agent calls: a steel wrench with a blue grip. */
export function McpServerIcon({ className }: { className?: string }) {
  return (
    <LitObject className={className}>
      <g transform="rotate(-45 12 12)">
        <Solid d={squircle(8, 10.7, 13.5, 2.6, 1.3)} material={MATERIALS.steel} />
        <Solid d="M1.4 10.7H5.6V13.3H1.4A4.3 4.3 0 1 0 1.4 10.7Z" material={MATERIALS.steel} />
        <Solid d={squircle(12.5, 10.3, 9.5, 3.4, 1.7)} material={MATERIALS.mcp} />
      </g>
    </LitObject>
  );
}

/** Spend: two gold coins, the back one peeking out top-right. */
export function CoinIcon({ className }: { className?: string }) {
  const coins = [
    { cx: 14.6, cy: 8.8, r: 6 },
    { cx: 10, cy: 13.2, r: 6.6 },
  ];
  return (
    <LitObject className={className}>
      {coins.map(({ cx, cy, r }) => (
        <g key={cx}>
          <Solid d={circle(cx, cy, r)} material={MATERIALS.coin} />
          <circle cx={cx} cy={cy} r={r * 0.72} fill="none" stroke={MATERIALS.coin.edge} strokeWidth="0.7" opacity="0.55" />
          <path d={sparkle(cx, cy, r * 0.38)} fill={MATERIALS.coin.edge} opacity="0.5" />
        </g>
      ))}
    </LitObject>
  );
}

interface Material {
  light: string;
  shade: string;
  edge: string;
}

const MATERIALS = {
  bulb: { light: '#fff6c2', shade: '#f2c230', edge: '#a87f0c' },
  steel: { light: '#eef1f6', shade: '#9aa3b3', edge: '#5d6577' },
  plugin: { light: '#c8f5dc', shade: '#3fbf82', edge: '#23845a' },
  mcp: { light: '#cfe0ff', shade: '#5f8de6', edge: '#3a62bd' },
  coin: { light: '#ffeeb0', shade: '#e5ac2e', edge: '#a8761b' },
} satisfies Record<string, Material>;

/** `d` as a solid: its extruded side in the edge colour, then the face lit from the top-left, then the sheen. */
function Solid({ d, material }: { d: string; material: Material }) {
  const id = useId();
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={material.light} />
          <stop offset="1" stopColor={material.shade} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={d} transform="translate(0 1)" fill={material.edge} />
      <path d={d} fill={`url(#${id})`} stroke={material.edge} strokeWidth="0.5" strokeLinejoin="round" />
      <path d={d} fill={`url(#${id}-sheen)`} />
    </>
  );
}

function LitObject({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4 shrink-0 overflow-visible', className)}>
      <ellipse cx="12" cy="22.2" rx="7.5" ry="0.9" fill="#000" opacity="0.18" />
      {children}
    </svg>
  );
}

function circle(cx: number, cy: number, r: number) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
}

/** A four-point star of radius `r`, its sides pinched toward the centre. */
function sparkle(cx: number, cy: number, r: number) {
  const k = r * 0.18;
  const n = (v: number) => +v.toFixed(2);
  return `M${n(cx)} ${n(cy - r)}C${n(cx + k)} ${n(cy - k)} ${n(cx + k)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}C${n(cx + k)} ${n(cy + k)} ${n(cx + k)} ${n(cy + k)} ${n(cx)} ${n(cy + r)}C${n(cx - k)} ${n(cy + k)} ${n(cx - k)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}C${n(cx - k)} ${n(cy - k)} ${n(cx - k)} ${n(cy - k)} ${n(cx)} ${n(cy - r)}Z`;
}
