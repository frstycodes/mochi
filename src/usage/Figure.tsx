import { cn } from '@/lib/utils';

type FigureKind = 'usd' | 'compact' | 'count' | 'signed';

/**
 * A headline number with its affixes at half size so the digits carry it: `$` and units (B, k, M) on the baseline, a sign
 * lifted to the digits' middle. Weight and size come from `className`.
 */
export function Figure({ value, kind, className }: { value: number; kind: FigureKind; className?: string }) {
  const { prefix, sign, digits, suffix } = figureParts(value, kind);
  return (
    <span className={cn('figure tracking-[-0.035em] whitespace-nowrap', className)}>
      {!!sign && <span className="relative -top-[0.4em] mr-[0.04em] text-[0.52em] tracking-normal">{sign}</span>}
      {!!prefix && <span className="mr-[0.06em] text-[0.5em] tracking-normal">{prefix}</span>}
      {digits}
      {!!suffix && <span className="ml-[0.06em] text-[0.5em] tracking-normal">{suffix}</span>}
    </span>
  );
}

function figureParts(value: number, kind: FigureKind) {
  if (kind === 'usd') return { prefix: '$', sign: '', digits: Math.round(value).toLocaleString('en-US'), suffix: '' };
  if (kind === 'count') return { prefix: '', sign: '', digits: value.toLocaleString('en-US'), suffix: '' };
  const [, digits, suffix] = /^([\d.,]+)(\D*)$/.exec(compact(Math.abs(value))) ?? [];
  return { prefix: '', sign: kind === 'signed' ? (value < 0 ? '−' : '+') : '', digits, suffix };
}

export function compact(value: number) {
  // Lowercase k for thousands, the way people write it; M and B stay capital.
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: value >= 1e9 ? 2 : value >= 1e6 ? 1 : 0 }).format(value).replace('K', 'k');
}

export function usd(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}
