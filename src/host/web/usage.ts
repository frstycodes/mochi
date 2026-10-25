import type {
  CommitStat,
  PrStat,
  TokenBucket,
  UsageHost,
} from '../types/usage.ts';
import { localDay } from '../../usage/days.ts';

// The web build has no logs or git: a week shaped like Mochi's own first week, ending today, so the page can be tried.
const DEMO_DAYS = [
  { opus: 146.5, codex: 0, commits: 9, added: 21247, removed: 228, prs: 0 },
  {
    opus: 584.5,
    codex: 0.01,
    commits: 180,
    added: 38945,
    removed: 5482,
    prs: 28,
  },
  {
    opus: 663.7,
    codex: 2.3,
    commits: 116,
    added: 28718,
    removed: 7153,
    prs: 71,
  },
  { opus: 396.5, codex: 0, commits: 90, added: 16353, removed: 3758, prs: 40 },
  {
    opus: 162.4,
    codex: 0.28,
    commits: 34,
    added: 6494,
    removed: 1044,
    prs: 23,
  },
  { opus: 234.6, codex: 0, commits: 40, added: 9711, removed: 2974, prs: 20 },
  { opus: 1.3, codex: 0, commits: 0, added: 0, removed: 0, prs: 0 },
];
const DAY = 86_400_000;
const PEAK_HOURS = [1, 1, 2, 12, 13, 13, 14, 17, 20, 20, 23];

export const usage: UsageHost = {
  async report({ since, roots, repos }) {
    // The demo week belongs to the profile's first project, so it shows under All projects and that project alike.
    const root = repos[0] ?? roots[0] ?? '/demo';
    const start = Date.now() - (DEMO_DAYS.length - 1) * DAY;
    const tokens: TokenBucket[] = [];
    const commits: CommitStat[] = [];
    const prs: PrStat[] = [];
    DEMO_DAYS.forEach((d, i) => {
      const at = start + i * DAY;
      if (since !== null && at < since - DAY) return;
      const day = localDay(at);
      // Spend split the way the real week split it: ~59% cache reads, ~27% cache writes (1-hour), ~14% output at Opus 5.5 rates.
      const opus = {
        input: 0.016,
        output: d.opus * 0.14,
        cacheRead: d.opus * 0.59,
        cacheWrite: d.opus * 0.27,
      };
      tokens.push({
        day,
        harness: 'claude',
        model: 'claude-opus-5-5',
        root,
        input: 4_000,
        output: (opus.output * 1e6) / 20,
        cacheRead: (opus.cacheRead * 1e6) / 0.2,
        cacheWrite5m: 0,
        cacheWrite1h: (opus.cacheWrite * 1e6) / 8,
        cost: opus,
        uncached: d.opus * 12,
      });
      if (d.codex) {
        const astra = {
          input: d.codex * 0.6,
          output: d.codex * 0.1,
          cacheRead: d.codex * 0.3,
          cacheWrite: 0,
        };
        tokens.push({
          day,
          harness: 'codex',
          model: 'gpt-6-astra',
          root,
          input: (astra.input * 1e6) / 10,
          output: (astra.output * 1e6) / 50,
          cacheRead: astra.cacheRead * 1e6,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cost: astra,
          uncached: d.codex * 3.7,
        });
      }
      for (let c = 0; c < d.commits; c++) {
        const hour = PEAK_HOURS[c % PEAK_HOURS.length];
        commits.push({
          repo: root,
          at: new Date(new Date(at).setHours(hour, c % 60)).getTime(),
          added: Math.round(d.added / d.commits),
          removed: Math.round(d.removed / d.commits),
          isMerge: false,
        });
      }
      for (let n = 0; n < d.prs; n++)
        prs.push({
          repo: root,
          number: prs.length + 1,
          state: 'MERGED',
          createdAt: at,
          mergedAt: at,
        });
    });
    return {
      tokens,
      sessions: [
        { harness: 'claude', root, id: 'demo' },
        { harness: 'codex', root, id: 'demo' },
      ],
      commits,
      prs,
      errors: [],
    };
  },
};
