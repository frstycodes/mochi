import { useId } from 'react';
import { cn } from '@/lib/utils';
import type { DeviceKind } from '../host/types/remote';
import { IS_MAC, IS_WINDOWS } from '../keys';
import { squircle } from '../icons/squircle';

/**
 * A device as a small object, lit like Mochi: a body lit from the top-left in its own subtle colour, a dark glass screen with
 * a sheen, and a soft contact shadow. Fixed materials, the same in both themes; the edge keeps it apart from a light page.
 * Each says its OS without a logo: a MacBook's notch, Windows' four panes, a Linux prompt, a phone's island. `kind`
 * undefined: a computer that hasn't said what it is.
 */
export function DeviceIcon({ kind, className }: { kind: DeviceKind | undefined; className?: string }) {
  const id = useId();
  const material = MATERIALS[kind ?? 'computer'];
  const paint = (name: string) => `url(#${id}-${name})`;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4 shrink-0 overflow-visible', className)}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={material.light} />
          <stop offset="1" stopColor={material.shade} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#2a3042" />
          <stop offset="1" stopColor="#12151d" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="21.4" rx={kind === 'phone' ? 4.5 : 8} ry="0.9" fill="#000" opacity="0.18" />
      {kind === 'phone' ? <Phone material={material} paint={paint} /> : kind === 'mac' ? <Laptop material={material} paint={paint} /> : <Monitor kind={kind} material={material} paint={paint} />}
    </svg>
  );
}

/** This computer, as other devices see it. */
export const THIS_DEVICE: DeviceKind = IS_MAC ? 'mac' : IS_WINDOWS ? 'windows' : 'linux';

interface Material {
  light: string;
  shade: string;
  edge: string;
  /** What's lit on its screen: Windows' panes, the Linux prompt. */
  glow: string;
}

const MATERIALS = {
  mac: { light: '#f1f2f5', shade: '#b4b9c4', edge: '#7f8593', glow: '#dfe3ea' },
  windows: { light: '#d9e7fd', shade: '#87aae4', edge: '#5379ba', glow: '#9ec5ff' },
  linux: { light: '#fdebd2', shade: '#e3ad6e', edge: '#b07d42', glow: '#ffcf8f' },
  phone: { light: '#ece4fd', shade: '#ae9be3', edge: '#7f6bbd', glow: '#d9ccff' },
  computer: { light: '#eceef2', shade: '#b0b5bf', edge: '#7c828f', glow: '#dfe3ea' },
} satisfies Record<DeviceKind | 'computer', Material>;

type PartProps = { material: Material; paint: (name: string) => string };

function Monitor({ kind, material, paint }: PartProps & { kind: DeviceKind | undefined }) {
  return (
    <>
      <path d="M10.4 15.5h3.2l.5 3.4h-4.2z" fill={paint('body')} stroke={material.edge} strokeWidth="0.5" strokeLinejoin="round" />
      <path d={squircle(7.5, 18.6, 9, 1.6, 0.8)} fill={paint('body')} stroke={material.edge} strokeWidth="0.5" />
      <path d={squircle(2.5, 3.5, 19, 12.6, 2.2)} fill={paint('body')} stroke={material.edge} strokeWidth="0.5" />
      <path d={squircle(4, 5, 16, 9.6, 1.2)} fill={paint('glass')} />
      {kind === 'windows' && <path d={[squircle(9.5, 6.95, 2.3, 2.3, 0.5), squircle(12.2, 6.95, 2.3, 2.3, 0.5), squircle(9.5, 9.65, 2.3, 2.3, 0.5), squircle(12.2, 9.65, 2.3, 2.3, 0.5)].join('')} fill={material.glow} />}
      {kind === 'linux' && <path d="M8 7.6 10.2 9.8 8 12M11.6 12h3.6" fill="none" stroke={material.glow} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
      <path d={squircle(4, 5, 16, 9.6, 1.2)} fill={paint('sheen')} />
    </>
  );
}

function Laptop({ material, paint }: PartProps) {
  return (
    <>
      <path d={squircle(3.8, 3.8, 16.4, 12, 2)} fill={paint('body')} stroke={material.edge} strokeWidth="0.5" />
      <path d={squircle(5.1, 5.1, 13.8, 9.4, 1)} fill={paint('glass')} />
      <path d="M10.9 5.1h2.2v.5a.6.6 0 0 1-.6.6h-1a.6.6 0 0 1-.6-.6z" fill="#05070b" />
      <path d={squircle(5.1, 5.1, 13.8, 9.4, 1)} fill={paint('sheen')} />
      <path d="M1.5 16.2h21l-.6 1.6a1.6 1.6 0 0 1-1.5 1H3.6a1.6 1.6 0 0 1-1.5-1z" fill={paint('body')} stroke={material.edge} strokeWidth="0.5" strokeLinejoin="round" />
      <path d="M10.2 16.2h3.6v.35a.5.5 0 0 1-.5.5h-2.6a.5.5 0 0 1-.5-.5z" fill={material.edge} opacity="0.5" />
    </>
  );
}

function Phone({ material, paint }: PartProps) {
  return (
    <>
      <path d={squircle(6.2, 1.8, 11.6, 19.4, 3.2)} fill={paint('body')} stroke={material.edge} strokeWidth="0.5" />
      <path d={squircle(7.3, 2.9, 9.4, 17.2, 2.3)} fill={paint('glass')} />
      <path d={squircle(10.4, 3.7, 3.2, 1.1, 0.55)} fill="#05070b" />
      <path d={squircle(7.3, 2.9, 9.4, 17.2, 2.3)} fill={paint('sheen')} />
    </>
  );
}
