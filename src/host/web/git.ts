import type { GitHost } from '../types/git.ts';

export const git: GitHost = {
  async status() {
    return {
      branch: 'feat/checkout-flow',
      files: [
        { path: 'src/checkout/Cart.tsx', status: 'modified' },
        { path: 'src/checkout/useTotals.ts', status: 'added' },
        { path: 'src/legacy/cart.js', status: 'deleted' },
      ],
    };
  },
  async diff() {
    return [
      'diff --git a/src/checkout/Cart.tsx b/src/checkout/Cart.tsx',
      '--- a/src/checkout/Cart.tsx',
      '+++ b/src/checkout/Cart.tsx',
      '@@ -1,3 +1,3 @@',
      "-import { totals } from '../legacy/cart';",
      "+import { useTotals } from './useTotals';",
      '',
    ].join('\n');
  },
};
