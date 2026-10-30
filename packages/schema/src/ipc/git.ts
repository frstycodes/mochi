import { Schema } from 'effect';
import { Int, invoke, Str } from '../checks.ts';
import { PullRequest } from '../model.ts';

const opt = Schema.optional;
const T = Schema.Tuple;
const o = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;

export const GitFileStatus = Schema.Struct({
  path: S,
  status: Schema.Literals(['modified', 'added', 'deleted', 'untracked']),
});

export const GitStatus = Schema.Struct({
  branch: S,
  files: Schema.Array(GitFileStatus),
});
export type GitStatus = typeof GitStatus.Type;

export const DiffScope = Schema.Literals(['branch', 'uncommitted']);
export type DiffScope = typeof DiffScope.Type;

export const ChangeKind = Schema.Literals([
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
]);

export const DiffHunk = Schema.Struct({
  header: S,
  patch: S,
  added: N,
  removed: N,
});

export const DiffFile = Schema.Struct({
  path: S,
  oldPath: opt(S),
  kind: ChangeKind,
  staged: B,
  binary: B,
  added: N,
  removed: N,
  patch: S,
  hunks: Schema.Array(DiffHunk),
});
export type DiffFile = typeof DiffFile.Type;

export const GitDiff = Schema.Struct({
  branch: S,
  base: S,
  files: Schema.Array(DiffFile),
});
export type GitDiff = typeof GitDiff.Type;

const MAX_PATCH = 8 * 1024 * 1024;

/** Main still checks `path` is inside the worktree and `patch` touches only that file. */
export const ChangeTarget = Schema.Struct({
  path: Str(),
  staged: B,
  untracked: opt(B),
  patch: opt(Str(MAX_PATCH)),
});
export type ChangeTarget = typeof ChangeTarget.Type;

export const CheckState = Schema.Literals([
  'pass',
  'fail',
  'pending',
  'skipping',
  'cancel',
]);

export const PrCheck = Schema.Struct({
  name: S,
  state: CheckState,
  link: opt(S),
});

export const PrInfo = Schema.Struct({
  number: N,
  url: S,
  title: S,
  state: S,
  checks: Schema.Array(PrCheck),
});
export type PrInfo = typeof PrInfo.Type;

export const PrComment = Schema.Struct({
  id: S,
  author: S,
  body: S,
  url: opt(S),
  at: S,
  verdict: opt(Schema.Literals(['approved', 'changes-requested'])),
});

export const ReviewThread = Schema.Struct({
  id: S,
  path: S,
  side: Schema.Literals(['additions', 'deletions']),
  line: Schema.NullOr(N),
  isResolved: B,
  comments: Schema.Array(PrComment),
});

export const MergeMethod = Schema.Literals(['squash', 'merge', 'rebase']);
export type MergeMethod = typeof MergeMethod.Type;
export const MergeMode = Schema.Literals(['now', 'bypass', 'auto']);

export const ReviewVerdict = Schema.Literals([
  'approve',
  'request-changes',
  'comment',
]);

export const PrReview = Schema.Struct({
  number: N,
  url: S,
  title: S,
  body: S,
  author: S,
  state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: B,
  base: S,
  head: S,
  isConflicting: B,
  mergeMethods: Schema.Array(MergeMethod),
  viewer: S,
  checks: Schema.Array(PrCheck),
  comments: Schema.Array(PrComment),
  threads: Schema.Array(ReviewThread),
  files: Schema.Array(DiffFile),
});
export type PrReview = typeof PrReview.Type;

export const Worktree = Schema.Struct({
  path: S,
  branch: Schema.NullOr(S),
  head: S,
});

export const Head = Schema.Struct({ branch: S, isDetached: B });

export const Branch = Schema.Struct({
  name: S,
  isRemote: B,
  committedAt: N,
  worktree: opt(S),
});

export const ChangeStat = Schema.Struct({ files: N, added: N, removed: N });

export const BranchList = Schema.Struct({
  current: Schema.NullOr(S),
  defaultBranch: S,
  changes: ChangeStat,
  branches: Schema.Array(Branch),
});
export type BranchList = typeof BranchList.Type;

export const SwitchOptions = Schema.Struct({
  changes: Schema.Literals(['refuse', 'stash', 'commit', 'bring', 'discard']),
});

export const WorktreeOptions = Schema.Struct({
  base: opt(Str(255)),
  isExisting: opt(B),
  isNew: opt(B),
});

export const SyncResult = Schema.Struct({
  base: S,
  conflicts: Schema.Array(S),
});

export const GhAccount = Schema.Struct({
  host: S,
  login: S,
  isActive: B,
  isValid: B,
});

export const RewindPreview = Schema.Struct({
  files: Schema.Array(S),
  outside: Schema.Array(S),
});

export const RefKind = Schema.Literals(['pr', 'issue']);

/** A PR or issue on GitHub (`src/chat/refs.ts`). */
export const GithubRef = Schema.Struct({
  owner: S,
  repo: S,
  number: N,
  kind: opt(RefKind),
});
export type GithubRef = typeof GithubRef.Type;

export const RepoSlug = Schema.Struct({ owner: S, repo: S });

export const RefState = Schema.Struct({
  kind: RefKind,
  status: Schema.Literals(['open', 'draft', 'merged', 'closed']),
  title: S,
  url: S,
  hasConflicts: B,
  isAutoMerge: B,
  checks: Schema.NullOr(Schema.Literals(['pass', 'fail', 'pending'])),
  checkCounts: Schema.NullOr(
    Schema.Struct({ passed: N, failed: N, running: N, total: N }),
  ),
  mergeMethods: Schema.NullOr(Schema.Array(MergeMethod)),
  review: Schema.NullOr(Schema.Literals(['approved', 'changes', 'required'])),
  isNotPlanned: B,
  author: Schema.NullOr(Schema.Struct({ login: S, avatarUrl: S })),
  updatedAt: Schema.NullOr(S),
  branch: Schema.NullOr(Schema.Struct({ head: S, base: S })),
  diff: Schema.NullOr(Schema.Struct({ added: N, removed: N, files: N })),
});
export type RefState = typeof RefState.Type;

/** The profile's GitHub account: `login`, or `host/login` off github.com; '' for gh's active account (`parseGithubAccount`). */
const GithubUser = Str(128).check(
  Schema.isPattern(/^(?:(?:[\w.-]+\/)?[\w-]+)?$/),
);
const User = o(GithubUser);
const PrNumber = Int.check(Schema.isBetween({ minimum: 1, maximum: 1e9 }));
const Body = Str(65_536);
/** A GraphQL node id (`PRRT_kwDO…`): it goes into gh's argv. */
const NodeId = Str(128).check(Schema.isPattern(/^[A-Za-z0-9_=-]+$/));
const ThreadId = Str(64);
/** It names the worktree's folder. */
const FolderThreadId = ThreadId.check(Schema.isPattern(/^[\w-]+$/));
const BranchName = Str(255);
const CheckpointN = Int.check(
  Schema.isBetween({ minimum: 0, maximum: 1_000_000 }),
);
const CommitHash = Str(64).check(
  Schema.isPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
);
const Cwd = Str();
const NotBlank = (max: number, what: string) =>
  Str(max).check(
    Schema.makeFilter((text) => !!text.trim() || `${what} is empty`),
  );

/**
 * `GitHost` (`src/host/types/git.ts`). Main still resolves every path inside its repo, keeps checkpoints and worktree removal
 * to Mochi worktrees, and drops refs `validRef` refuses rather than failing the call.
 */
export const gitRpc = {
  status: invoke(T([Cwd]), GitStatus),
  diff: invoke(T([Cwd, DiffScope, o(BranchName)]), GitDiff),
  stage: invoke(T([Cwd, ChangeTarget]), Schema.Void),
  unstage: invoke(T([Cwd, ChangeTarget]), Schema.Void),
  revert: invoke(T([Cwd, ChangeTarget]), Schema.Void),
  commit: invoke(T([Cwd, NotBlank(10_000, 'Commit message')]), S),
  push: invoke(T([Cwd, User]), Schema.Void),
  createPr: invoke(
    T([
      Cwd,
      Schema.Struct({
        title: NotBlank(256, 'PR title'),
        body: Body,
        base: opt(Str(256)),
      }),
      User,
    ]),
    S,
  ),
  pr: invoke(T([Cwd, User]), Schema.NullOr(PrInfo)),
  worktreePrs: invoke(
    T([Schema.Array(Cwd), User]),
    Schema.Array(Schema.Struct({ worktree: S, pr: PullRequest })),
  ),
  setAutoMerge: invoke(T([Cwd, PrNumber, B, User]), Schema.Void),
  prReview: invoke(T([Cwd, PrNumber, User]), Schema.NullOr(PrReview)),
  commentPr: invoke(T([Cwd, PrNumber, Body, User]), Schema.Void),
  replyThread: invoke(T([Cwd, NodeId, Body, User]), Schema.Void),
  resolveThread: invoke(T([Cwd, NodeId, B, User]), Schema.Void),
  reviewPr: invoke(T([Cwd, PrNumber, ReviewVerdict, Body, User]), Schema.Void),
  mergePr: invoke(
    T([Cwd, PrNumber, MergeMethod, MergeMode, User]),
    Schema.Void,
  ),
  ciLog: invoke(T([Cwd, Str(2048), User]), S),
  repoSlug: invoke(T([Cwd]), Schema.NullOr(RepoSlug)),
  refStates: invoke(
    T([Schema.NullOr(Cwd), Schema.Array(GithubRef), User]),
    Schema.Record(S, RefState),
  ),
  ghAccounts: invoke(T([]), Schema.Array(GhAccount)),
  sync: invoke(T([Cwd, o(BranchName)]), SyncResult),
  addWorktree: invoke(
    T([Cwd, FolderThreadId, BranchName, o(WorktreeOptions)]),
    S,
  ),
  branches: invoke(T([Cwd]), BranchList),
  branchNameError: invoke(T([Cwd, BranchName]), Schema.NullOr(S)),
  switchBranch: invoke(T([Cwd, BranchName, SwitchOptions]), Schema.Void),
  renameAutoBranch: invoke(T([Cwd, BranchName, Str(255)]), Schema.NullOr(S)),
  worktrees: invoke(T([Cwd]), Schema.Array(Worktree)),
  head: invoke(T([Cwd]), Head),
  removeWorktree: invoke(T([Cwd]), Schema.Void),
  diskUsage: invoke(T([Cwd]), N),
  checkpoint: invoke(
    T([
      Cwd,
      ThreadId,
      Schema.Union([CheckpointN, Schema.Literals(['turn', 'undo'])]),
    ]),
    S,
  ),
  restoreCheckpoint: invoke(
    T([
      Cwd,
      ThreadId,
      Schema.Union([CheckpointN, Schema.Literal('undo')]),
      o(B),
    ]),
    Schema.Void,
  ),
  restoreFiles: invoke(
    T([
      Cwd,
      ThreadId,
      Schema.Union([CheckpointN, Schema.Literal('undo')]),
      Schema.Array(Str()).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    ]),
    Schema.Void,
  ),
  rewindPreview: invoke(T([Cwd, ThreadId, CheckpointN]), RewindPreview),
  checkpointDiff: invoke(T([Cwd, ThreadId, CheckpointN]), GitDiff),
  turnDiff: invoke(T([Cwd, CommitHash, o(CommitHash)]), Schema.Array(DiffFile)),
  forkWorktree: invoke(
    T([
      Cwd,
      FolderThreadId,
      BranchName,
      o(Schema.Struct({ threadId: ThreadId, n: CheckpointN })),
    ]),
    S,
  ),
};
