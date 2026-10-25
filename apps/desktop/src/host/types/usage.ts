import type { Provider } from '../../model.ts';
import type { Manifest } from '@mochi/domain/host/types/manifest';

/**
 * Usage history read from the harnesses' own logs and the repositories, for the Usage page. Mochi keeps only a running
 * total per thread, so per-day spend comes from Claude Code's `projects/*.jsonl` and Codex's `sessions/` logs instead.
 */
export interface UsageHost {
  report(query: UsageQuery): Promise<UsageReport>;
}

export interface UsageQuery {
  /** Folders whose agent sessions count: project roots and their worktrees. A session counts when its cwd is in one. */
  roots: string[];
  /** Repositories to read commits and pull requests from: project roots only, since worktrees share their history. */
  repos: string[];
  /** Epoch ms; null for all time. */
  since: number | null;
  /** The profile's GitHub login for `gh`; gh's active account when absent. */
  githubUser?: string;
}

export interface UsageReport {
  tokens: TokenBucket[];
  sessions: UsageSession[];
  commits: CommitStat[];
  prs: PrStat[];
  /** Sources that failed (a repo without git, gh logged out), each a sentence for the page's footnote. */
  errors: string[];
}

/** One model's tokens in one root on one local day. `input` excludes cache reads and writes. */
export interface TokenBucket {
  day: string;
  harness: Provider;
  model: string;
  root: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Claude's 5-minute and 1-hour cache writes, priced differently; Codex reports none. */
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** What these tokens cost at list price, by kind; null when the model has no price. */
  cost: CostParts | null;
  /** The same tokens priced with no prompt cache; null when the model has no price. */
  uncached: number | null;
}

/** Dollars, by kind of token. */
export interface CostParts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageSession {
  harness: Provider;
  root: string;
  id: string;
}

export interface CommitStat {
  repo: string;
  /** Epoch ms. */
  at: number;
  added: number;
  removed: number;
  isMerge: boolean;
}

export interface PrStat {
  repo: string;
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  createdAt: number;
  mergedAt: number | null;
}

export const usageMethods = {
  report: 'invoke',
} satisfies Manifest<UsageHost>;
