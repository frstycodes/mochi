export type RefKind = 'pr' | 'issue';
/** `merged` is PR-only; `unknown` when the state couldn't be read (no gh, signed out, offline, no access). */
export type RefStatus = 'open' | 'draft' | 'merged' | 'closed' | 'unknown';

/** A GitHub PR or issue. `kind` is known up front only from a URL (`/pull/` vs `/issues/`); `#n` could be either until fetched. */
export interface GithubRef {
  owner: string;
  repo: string;
  number: number;
  kind?: RefKind;
}

export type MergeMethod = 'squash' | 'merge' | 'rebase';

/** The head commit's check rollup: `fail` covers failure and error, `pending` covers expected. */
export type ChecksState = 'pass' | 'fail' | 'pending';
/** GitHub's `reviewDecision`: `required` means a review is requested and none approved yet. */
export type ReviewState = 'approved' | 'changes' | 'required';

export interface RefState {
  kind: RefKind;
  status: Exclude<RefStatus, 'unknown'>;
  title: string;
  url: string;
  /** Open PR that can't merge cleanly (`mergeable: CONFLICTING`). */
  hasConflicts: boolean;
  /** GitHub auto-merge is on: it merges once required checks and reviews pass. */
  isAutoMerge: boolean;
  /** Null when the PR has no checks, and for issues. */
  checks: ChecksState | null;
  /** Checks that passed (skipped and neutral count), failed and are still running, out of all of them; null when unread or there are none. */
  checkCounts: {
    passed: number;
    failed: number;
    running: number;
    total: number;
  } | null;
  review: ReviewState | null;
  /** Issues closed as not planned read as muted, not done. */
  isNotPlanned: boolean;
  /** Null for a deleted account. */
  author: { login: string; avatarUrl: string } | null;
  /** ISO timestamp. */
  updatedAt: string | null;
  /** PR only. */
  branch: { head: string; base: string } | null;
  diff: { added: number; removed: number; files: number } | null;
  /** PR only: the merge methods its repository allows, in GitHub's order. */
  mergeMethods: readonly MergeMethod[] | null;
}

/** A state with only what's known without GitHub: the thread's own record of a PR, demo fixtures. */
export function bareState(
  kind: RefKind,
  status: RefState['status'],
  title: string,
  url: string,
): RefState {
  return {
    kind,
    status,
    title,
    url,
    hasConflicts: false,
    isAutoMerge: false,
    checks: null,
    checkCounts: null,
    mergeMethods: null,
    review: null,
    isNotPlanned: false,
    author: null,
    updatedAt: null,
    branch: null,
    diff: null,
  };
}

/** The thread's own repository, for bare `#123` and for showing its refs without the `owner/repo` prefix. */
export interface RepoSlug {
  owner: string;
  repo: string;
}

export type RefSegment =
  | { type: 'text'; text: string }
  | { type: 'ref'; text: string; ref: GithubRef }
  | { type: 'path'; text: string };

const URL_REF =
  /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#][^\s]*)?$/i;

// owner/repo#n or a bare #n. The lookbehind keeps `C#`, `page#3`, `a/b/c#4` and `&#123` out.
const TEXT_REF = /(?<![\w/#&.-])(?:([\w.-]+)\/([\w.-]+))?#(\d+)(?![\w-])/g;

// A relative path with at least one `/` and an extension, optionally `:line[:col]` (as in the terminal's link finder), but
// not the path part of a URL or an `owner/repo` that's followed by `#n`.
// A file picked from `@` in the composer, as it reads in the sent message: `@src/a.ts`, `@../x/`, `@"~/my notes.md"`. Needs a
// `/` or `.` so a handle (`@claude`) stays text; a trailing full stop is the sentence's.
const FILE_MENTION = /(?<!\S)@(?:"[^"\n]+"|[\w.~/-]+)/g;

const TEXT_PATH =
  /(?<![\w:/.@#-])(?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?::\d+){0,2}(?![\w/#])/g;

// "our #1 priority", "the #2 spot": a single-digit bare ref between a determiner and a word is a ranking, not an issue
// ("#9 was fixed" still links).
const RANKING_BEFORE =
  /\b(?:our|the|a|an|my|your|their|its|his|her|ranked|number)\s+$/i;
const RANKING_AFTER = /^#\d\s+\p{L}/u;

/** A github.com PR or issue URL → its ref; null for anything else. */
export function refFromUrl(href: string): GithubRef | null {
  const m = href.match(URL_REF);
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    number: Number(m[4]),
    kind: m[3].toLowerCase() === 'pull' ? 'pr' : 'issue',
  };
}

/** Stable cache key and display label: `owner/repo#n`. */
export function refKey(ref: GithubRef) {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

/** `#n` for the thread's own repo, `owner/repo#n` otherwise. */
export function refLabel(ref: GithubRef, home: RepoSlug | null) {
  return isSameRepo(ref, home) ? `#${ref.number}` : refKey(ref);
}

export function refUrl(ref: GithubRef) {
  return `https://github.com/${ref.owner}/${ref.repo}/${ref.kind === 'issue' ? 'issues' : 'pull'}/${ref.number}`;
}

/**
 * Splits prose into text, `owner/repo#n` / `#n` refs and file paths. Bare `#n` needs `home`; without it, it stays text.
 * URLs are not handled here: GFM autolinks them into `<a>` first, and the link renderer reads them with `refFromUrl`.
 */
export function splitRefs(text: string, home: RepoSlug | null): RefSegment[] {
  const hits: { start: number; end: number; segment: RefSegment }[] = [];
  for (const m of text.matchAll(TEXT_REF)) {
    const [whole, owner, repo, number] = m;
    if (!owner && (!home || isRanking(text, m.index))) continue;
    const ref = owner
      ? { owner, repo, number: Number(number) }
      : { ...home!, number: Number(number) };
    hits.push({
      start: m.index,
      end: m.index + whole.length,
      segment: { type: 'ref', text: whole, ref },
    });
  }
  for (const m of text.matchAll(FILE_MENTION)) {
    const whole = m[0].startsWith('@"') ? m[0] : m[0].replace(/\.+$/, '');
    if (
      !/[/.]/.test(whole.slice(1)) ||
      hits.some((h) => m.index < h.end && m.index + whole.length > h.start)
    )
      continue;
    hits.push({
      start: m.index,
      end: m.index + whole.length,
      segment: { type: 'path', text: whole },
    });
  }
  for (const m of text.matchAll(TEXT_PATH)) {
    if (hits.some((h) => m.index < h.end && m.index + m[0].length > h.start))
      continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      segment: { type: 'path', text: m[0] },
    });
  }
  if (hits.length === 0) return [{ type: 'text', text }];
  hits.sort((a, b) => a.start - b.start);
  const segments: RefSegment[] = [];
  let at = 0;
  for (const hit of hits) {
    if (hit.start > at)
      segments.push({ type: 'text', text: text.slice(at, hit.start) });
    segments.push(hit.segment);
    at = hit.end;
  }
  if (at < text.length) segments.push({ type: 'text', text: text.slice(at) });
  return segments;
}

export type RefTone =
  | 'success'
  | 'muted'
  | 'merged'
  | 'destructive'
  | 'warning'
  | 'info';

/** Semantic colour role for a ref's state. Unread state is the link colour, so the chip still reads as clickable. */
export function refTone(state: RefState | null | undefined): RefTone {
  if (!state) return 'info';
  if (state.kind === 'issue') {
    if (state.status === 'open') return 'success';
    if (state.status === 'draft') return 'muted';
    return state.isNotPlanned ? 'muted' : 'merged';
  }
  if (state.status === 'merged') return 'merged';
  if (state.status === 'closed') return 'destructive';
  if (state.status === 'draft') return 'muted';
  return state.hasConflicts ? 'warning' : 'success';
}

export function refStatus(state: RefState | null | undefined): RefStatus {
  return state?.status ?? 'unknown';
}

/** Words for the tooltip and screen readers: "Open pull request, has conflicts, checks failing". */
export function refDescription(
  refKind: RefKind | undefined,
  state: RefState | null | undefined,
) {
  const kind = state?.kind ?? refKind;
  const noun =
    kind === 'issue'
      ? 'issue'
      : kind === 'pr'
        ? 'pull request'
        : 'pull request or issue';
  if (!state) return `GitHub ${noun}`;
  const status = state.isNotPlanned
    ? 'Closed as not planned'
    : STATUS_WORDS[state.status];
  const extras = [
    state.hasConflicts && 'has conflicts',
    state.checks === 'fail' && 'checks failing',
    state.review === 'changes' && 'changes requested',
  ].filter(Boolean);
  return [`${status} ${noun}`, ...extras].join(', ');
}

/**
 * Lower ranks need you sooner: an open PR with conflicts, failing checks or changes requested, then one waiting on review,
 * then open, draft, merged, closed. Unread state ranks with open, since it may still need you.
 */
export function refAttention(state: RefState | null | undefined) {
  if (!state || state.status === 'open') {
    if (
      state &&
      (state.hasConflicts ||
        state.checks === 'fail' ||
        state.review === 'changes')
    )
      return 0;
    if (state?.review === 'required') return 1;
    return 2;
  }
  return ATTENTION_RANK[state.status];
}

const ATTENTION_RANK = { draft: 3, merged: 4, closed: 5 } satisfies Record<
  Exclude<RefState['status'], 'open'>,
  number
>;

/** `items` most-needs-you first; equal ranks keep their order. */
export function byAttention<T>(
  items: T[],
  stateOf: (item: T) => RefState | null | undefined,
) {
  return [...items].sort(
    (a, b) => refAttention(stateOf(a)) - refAttention(stateOf(b)),
  );
}

export const STATUS_WORDS = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
} satisfies Record<RefState['status'], string>;

function isRanking(text: string, at: number) {
  return (
    RANKING_AFTER.test(text.slice(at)) && RANKING_BEFORE.test(text.slice(0, at))
  );
}

function isSameRepo(ref: GithubRef, home: RepoSlug | null) {
  return (
    !!home &&
    ref.owner.toLowerCase() === home.owner.toLowerCase() &&
    ref.repo.toLowerCase() === home.repo.toLowerCase()
  );
}
