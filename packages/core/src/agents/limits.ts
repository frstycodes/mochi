import type {
  AccountLimits,
  LimitWindow,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { mergeWindows } from '../../../../apps/desktop/src/usage/limits.ts';
import { push } from './events.ts';

interface LimitDocs {
  list: () => Promise<ReadonlyArray<{ key: string; value: unknown }>>;
  set: (accountId: string, limits: AccountLimits) => Promise<void>;
}

let docs: LimitDocs = { list: async () => [], set: async () => {} };

/** Set once by the agents layer: the store's `limits` table. */
export const useLimitDocs = (next: LimitDocs) => void (docs = next);

/** The latest plan windows per account, kept across restarts; every change goes to open windows on `agent:onLimits`. */
let known: Record<string, AccountLimits> | null = null;
async function load() {
  known ??= Object.fromEntries(
    (await docs.list()).map(({ key, value }) => [key, value as AccountLimits]),
  );
  return known;
}

export async function limitsOf(
  accountId: string,
  provider: Provider,
): Promise<AccountLimits> {
  return (await load())[accountId] ?? { accountId, provider, windows: [] };
}

/** `isFull`: a read that lists every window the plan has, so windows it leaves out are gone. */
export async function recordLimits(
  accountId: string,
  provider: Provider,
  windows: LimitWindow[],
  isFull = false,
) {
  if (!windows.length && !isFull) return;
  const all = await load();
  const limits: AccountLimits = {
    accountId,
    provider,
    windows: isFull
      ? mergeWindows([], windows)
      : mergeWindows(all[accountId]?.windows ?? [], windows),
    updatedAt: new Date().toISOString(),
  };
  all[accountId] = limits;
  // A failed write is logged by the store; the next read of the plan writes it again.
  void docs.set(accountId, limits).catch(() => {});
  push({ channel: 'agent:onLimits', payload: limits });
}
