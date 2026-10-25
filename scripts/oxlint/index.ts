import { definePlugin } from 'vite-plus/lint/plugins';
import noEmDashCopy from './rules/no-em-dash-copy.ts';
import noHooklessUseFunction from './rules/no-hookless-use-function.ts';
import noLowValueComments from './rules/no-low-value-comments.ts';
import noManualEffectRuntimeInTests from './rules/no-manual-effect-runtime-in-tests.ts';
import noManualMemo from './rules/no-manual-memo.ts';
import noPollingLoopInTests from './rules/no-polling-loop-in-tests.ts';
import noRealTimeWaitInTests from './rules/no-real-time-wait-in-tests.ts';
import noTestInLoop from './rules/no-test-in-loop.ts';
import noWallClockInTests from './rules/no-wall-clock-in-tests.ts';
import requireSuppressionReason from './rules/require-suppression-reason.ts';

export default definePlugin({
  meta: { name: 'mochi' },
  rules: {
    'no-em-dash-copy': noEmDashCopy,
    'no-hookless-use-function': noHooklessUseFunction,
    'no-low-value-comments': noLowValueComments,
    'no-manual-effect-runtime-in-tests': noManualEffectRuntimeInTests,
    'no-manual-memo': noManualMemo,
    'no-polling-loop-in-tests': noPollingLoopInTests,
    'no-real-time-wait-in-tests': noRealTimeWaitInTests,
    'no-test-in-loop': noTestInLoop,
    'no-wall-clock-in-tests': noWallClockInTests,
    'require-suppression-reason': requireSuppressionReason,
  },
});
