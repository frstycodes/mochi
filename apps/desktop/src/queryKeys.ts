import type { DiffScope } from './host/types/git.ts';
import type { AccountId } from './host/types/settings.ts';
import type { Provider } from './model.ts';
import type { RangeId } from './usage/report.ts';

/** Every cache key. A family's `all` is the prefix its invalidations match, so members must extend it. */
export const queryKeys = {
  account: () => ['mochi-account'] as const,
  schedules: () => ['schedules'] as const,
  agent: {
    settings: () => ['agent-settings'] as const,
    accounts: () => ['accounts'] as const,
    install: (accountId: AccountId) => ['agent-install', accountId] as const,
    version: (provider: Provider) => ['agent-version', provider] as const,
    apiKey: (provider: Provider) => ['api-key', provider] as const,
    models: (spaceId: string, provider: Provider) =>
      ['models', spaceId, provider] as const,
    unavailable: (spaceId: string) => ['harness-unavailable', spaceId] as const,
    notes: {
      all: () => ['harness-notes'] as const,
      space: (spaceId: string) => ['harness-notes', spaceId] as const,
    },
    limits: (provider: Provider, spaceId: string) =>
      ['account-limits', provider, spaceId] as const,
    widget: (threadId: string, server: string, uri: string) =>
      ['mcp-widget', threadId, server, uri] as const,
    contextUsage: (threadId: string, used: number) =>
      ['context-usage', threadId, used] as const,
    taskOutput: (outputFile: string | undefined, isRunning: boolean) =>
      ['task-output', outputFile, isRunning] as const,
  },
  profile: {
    config: {
      all: () => ['profile-config'] as const,
      space: (spaceId: string | undefined) =>
        ['profile-config', spaceId] as const,
      root: (spaceId: string | undefined, root: string | undefined) =>
        ['profile-config', spaceId, root] as const,
    },
    folder: (spaceId: string) => ['profile-folder', spaceId] as const,
    instructions: (spaceId: string, name: string) =>
      ['profile-instructions', spaceId, name] as const,
    settingsSources: (profileId: string) =>
      ['settings-sources', profileId] as const,
    githubAccounts: () => ['github-accounts'] as const,
  },
  reviewer: {
    all: () => ['reviewer'] as const,
    check: (spaceId: string, provider: Provider) =>
      ['reviewer', spaceId, provider] as const,
  },
  projects: {
    list: (spaceId: string) => ['projects', spaceId] as const,
    machine: (machineId: string) => ['machine-projects', machineId] as const,
    githubRepos: (
      spaceId: string | null | undefined,
      login: string | undefined,
    ) => ['github-repos', spaceId, login] as const,
    folderMatches: (dir: string, full: string) =>
      ['folder-matches', dir, full] as const,
  },
  library: {
    all: () => ['library'] as const,
    space: (spaceId: string) => ['library', spaceId] as const,
    catalog: (key: string) => ['catalog', key] as const,
    marketplaces: {
      all: () => ['marketplaces'] as const,
      key: (key: string) => ['marketplaces', key] as const,
    },
    nativeItems: {
      all: () => ['native-items'] as const,
      profiles: (profileIds: readonly string[]) =>
        ['native-items', profileIds] as const,
    },
    connectorSettings: () => ['connector-settings'] as const,
    ownAppRedirect: () => ['own-app-redirect'] as const,
    oauthApps: () => ['oauth-apps'] as const,
    uploadReview: (file: File) =>
      ['upload-review', file.name, file.size, file.lastModified] as const,
  },
  chat: {
    imageBlob: (src: string) => ['image-blob', src] as const,
    githubRef: {
      ref: (refKey: string) => ['github-ref', refKey] as const,
      scoped: (
        refKey: string,
        cwd: string | null,
        githubUser: string | undefined,
      ) => ['github-ref', refKey, cwd, githubUser] as const,
    },
    repoSlug: (cwd: string | null) => ['repo-slug', cwd] as const,
    turnDiff: (cwd: string | null, from: string | undefined, toOrNow: string) =>
      ['turn-diff', cwd, from, toOrNow] as const,
    folderEntries: (target: string | null, dir: string | null) =>
      ['folder-entries', target, dir] as const,
    appWindows: () => ['app-windows'] as const,
  },
  files: {
    list: (root: string | null) => ['files', root] as const,
    content: (root: string, path: string) =>
      ['file-content', root, path] as const,
    viewerContent: (url: string) => ['viewer-content', url] as const,
    editors: () => ['installed-editors'] as const,
  },
  git: {
    diff: (cwd: string, scope: DiffScope, base: string | undefined) =>
      ['git-diff', cwd, scope, base] as const,
    branches: (root: string) => ['git-branches', root] as const,
    pr: (cwd: string, githubUser: string | undefined) =>
      ['git-pr', cwd, githubUser] as const,
    review: (cwd: string, pr: number, githubUser: string | undefined) =>
      ['git-review', cwd, pr, githubUser] as const,
    branchPrs: (cwd: string, githubUser: string | undefined) =>
      ['github-pr', cwd, githubUser] as const,
    branchNameError: (root: string, name: string | undefined) =>
      ['branch-name-error', root, name] as const,
    rewindPreview: (
      cwd: string | undefined,
      threadId: string,
      n: number | undefined,
      isWorking: boolean,
    ) => ['rewind-preview', cwd, threadId, n, isWorking] as const,
  },
  ports: {
    launchTargets: (cwd: string | null) => ['launch-targets', cwd] as const,
    listening: (cwd: string | null) => ['ports-listening', cwd] as const,
    threadPort: (threadId: string) => ['thread-port', threadId] as const,
  },
  remote: {
    machines: () => ['machines'] as const,
    cachedMachines: () => ['cached-machines'] as const,
    otherMachines: () => ['other-machines'] as const,
    status: () => ['remote-status'] as const,
    catalog: (machineId: string | undefined, isOnline: boolean) =>
      ['machine-catalog', machineId, isOnline] as const,
    read: (machineId: string, key: readonly unknown[]) =>
      ['machine-read', machineId, ...key] as const,
  },
  updates: {
    state: () => ['update-state'] as const,
  },
  notify: {
    permission: () => ['notify-permission'] as const,
    pendingOpen: () => ['pending-open'] as const,
  },
  sim: {
    list: () => ['simulators'] as const,
    appearance: (udid: string | null) => ['sim-appearance', udid] as const,
    contentSize: (udid: string | null) => ['sim-content-size', udid] as const,
  },
  themes: {
    installed: () => ['installed-themes'] as const,
    search: (query: string) => ['theme-search', query] as const,
    inspect: (
      namespace: string,
      name: string,
      version: string,
      displayName: string,
    ) => ['theme-inspect', namespace, name, version, displayName] as const,
  },
  usage: {
    report: (
      range: RangeId,
      spaceId: string,
      githubUser: string | undefined,
      roots: readonly string[] | undefined,
      repos: readonly string[] | undefined,
      now: number,
    ) => ['usage', range, spaceId, githubUser, roots, repos, now] as const,
    replays: () => ['replay-usage'] as const,
  },
  stage: {
    threadSnapshot: (threadId: string) =>
      ['thread-snapshot', threadId] as const,
    previewFrame: (hostId: string | null | undefined) =>
      ['preview-frame', hostId] as const,
  },
  developer: {
    metrics: () => ['developer-metrics'] as const,
  },
  browser: {
    suggestions: (searchEngine: string, query: string) =>
      ['search-suggestions', searchEngine, query] as const,
  },
};
