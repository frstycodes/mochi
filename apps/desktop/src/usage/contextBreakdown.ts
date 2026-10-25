import type { ContextUsage } from '../host/types/agent.ts';

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
const KIND_COLORS = {
  used: 'var(--muted-foreground)',
  buffer: 'color-mix(in oklab, var(--muted-foreground) 35%, transparent)',
  free: 'var(--muted)',
} satisfies Record<
  Exclude<ContextUsage['categories'][number]['kind'], 'deferred'>,
  string
>;

export interface ContextRow {
  name: string;
  tokens: number;
  /** 0–1 of the window. */
  share: number;
  color: string;
  kind: 'used' | 'buffer' | 'free';
}

/**
 * The window as bar segments and legend rows, Claude Code's `/context` order, empty rows dropped. The largest used rows take the
 * chart colours, the rest grey. Without a live breakdown (no Claude session, or Codex), the thread's own used/max as two rows.
 */
export function contextBreakdown(
  usage: ContextUsage | null,
  context: { used: number; max: number },
) {
  const categories = usage?.categories ?? [
    { name: 'Used', tokens: context.used, kind: 'used' as const },
    {
      name: 'Free space',
      tokens: Math.max(0, context.max - context.used),
      kind: 'free' as const,
    },
  ];
  const inWindow = categories.filter(
    (c): c is ContextRow & typeof c => c.kind !== 'deferred' && c.tokens > 0,
  );
  const window = inWindow.reduce((sum, c) => sum + c.tokens, 0);
  const bySize = inWindow
    .filter((c) => c.kind === 'used')
    .toSorted((a, b) => b.tokens - a.tokens);
  const rows: ContextRow[] = inWindow.map((c) => ({
    name: c.name,
    tokens: c.tokens,
    kind: c.kind,
    share: window ? c.tokens / window : 0,
    color:
      c.kind === 'used'
        ? (PALETTE[bySize.indexOf(c)] ?? KIND_COLORS.used)
        : KIND_COLORS[c.kind],
  }));
  const deferred = categories.filter(
    (c) => c.kind === 'deferred' && c.tokens > 0,
  );
  const usedTokens = usage?.totalTokens ?? context.used;
  return {
    rows,
    deferred,
    used: usedTokens,
    window: window || context.max,
    share: window ? Math.min(1, usedTokens / window) : 0,
  };
}
