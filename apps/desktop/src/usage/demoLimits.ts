import type { AccountLimits } from '../host/types/agent.ts';
import type { Provider } from '../model.ts';

const MINUTE = 60_000;
const from = (minutes: number) =>
  new Date(Date.now() + minutes * MINUTE).toISOString();

/** The demo Claude account's 5-hour window is spent: the demo thread `limit` waits for this reset. */
export const DEMO_FIVE_HOUR_RESET = from(134);
/** The demo Codex account's weekly window is spent: the demo thread `limit-codex` waits for this reset. */
export const DEMO_CODEX_RESET = from(5 * 1440 + 30);

// GAP: demo data for the web build; the desktop build reads each account's real windows (`electron/agents/limits.ts`).
// Codex shows a plan with only a weekly window.
export function demoLimits(provider: Provider): AccountLimits {
  const windows =
    provider === 'claude'
      ? [
          {
            id: 'five_hour',
            label: '5-hour',
            usedPct: 100,
            resetsAt: DEMO_FIVE_HOUR_RESET,
          },
          {
            id: 'seven_day',
            label: 'Weekly',
            usedPct: 76,
            resetsAt: from(3 * 1440 + 260),
          },
          {
            id: 'seven_day_opus',
            label: 'Weekly · Opus',
            usedPct: 93,
            resetsAt: from(3 * 1440 + 260),
          },
        ]
      : [
          {
            id: 'primary',
            label: 'Weekly',
            usedPct: 100,
            resetsAt: DEMO_CODEX_RESET,
          },
        ];
  return {
    accountId: `demo-${provider}`,
    provider,
    windows,
    updatedAt: new Date(Date.now() - 3 * MINUTE).toISOString(),
  };
}
