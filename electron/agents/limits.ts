import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AccountLimits, LimitWindow } from '../../src/host/types/agent.ts';
import type { Provider } from '../../src/model.ts';
import { mergeWindows } from '../../src/usage/limits.ts';
import { openWindows } from './events.ts';

/** The latest plan windows per account, kept across restarts; every change goes to open windows on `agent:onLimits`. */
let known: Record<string, AccountLimits> | null = null;
const file = () => join(app.getPath('userData'), 'limits.json');

async function load() {
  known ??= await readFile(file(), 'utf8').then((text) => JSON.parse(text) as Record<string, AccountLimits>, () => ({}));
  return known;
}

export async function limitsOf(accountId: string, provider: Provider): Promise<AccountLimits> {
  return (await load())[accountId] ?? { accountId, provider, windows: [] };
}

/** `isFull`: a read that lists every window the plan has, so windows it leaves out are gone. */
export async function recordLimits(accountId: string, provider: Provider, windows: LimitWindow[], isFull = false) {
  if (!windows.length && !isFull) return;
  const all = await load();
  const limits: AccountLimits = { accountId, provider, windows: isFull ? mergeWindows([], windows) : mergeWindows(all[accountId]?.windows ?? [], windows), updatedAt: new Date().toISOString() };
  all[accountId] = limits;
  void writeFile(file(), JSON.stringify(all)).catch((error) => console.warn('Could not save limits', error));
  for (const win of openWindows()) win.webContents.send('agent:onLimits', limits);
}
