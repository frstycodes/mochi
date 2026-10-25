import { definePlugin } from 'vite-plus/lint/plugins';
import noEmDashCopy from './rules/no-em-dash-copy.ts';
import noHooklessUseFunction from './rules/no-hookless-use-function.ts';
import noLowValueComments from './rules/no-low-value-comments.ts';
import noManualMemo from './rules/no-manual-memo.ts';
import requireSuppressionReason from './rules/require-suppression-reason.ts';

export default definePlugin({
  meta: { name: 'mochi' },
  rules: {
    'no-em-dash-copy': noEmDashCopy,
    'no-hookless-use-function': noHooklessUseFunction,
    'no-low-value-comments': noLowValueComments,
    'no-manual-memo': noManualMemo,
    'require-suppression-reason': requireSuppressionReason,
  },
});
