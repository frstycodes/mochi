import { normalizeOrigin, repoName } from '../../git/origin.ts';
import type { GithubRepo, Project, ProjectsHost } from '../types/projects.ts';

// A browser has no folders or git: projects live in memory, and Add project pretends, so the flows can be tried.
const spaces = new Map<string, { projects: Project[]; isMigrated: boolean }>();
const changeListeners = new Set<(spaceId: string) => void>();
const progressListeners = new Set<
  (progress: { opId: string; line: string }) => void
>();

const REPOS: GithubRepo[] = [
  {
    name: 'frstycodes/mochi',
    description: 'A calm workspace for running many coding agents at once',
    isPrivate: false,
    updatedAt: '2026-10-15T12:00:00Z',
  },
  {
    name: 'frstycodes/agent-skills',
    description: 'Skills for Claude Code and Codex',
    isPrivate: false,
    updatedAt: '2026-10-12T09:00:00Z',
  },
  {
    name: 'frstycodes/liane',
    description: '',
    isPrivate: true,
    updatedAt: '2026-09-30T18:00:00Z',
  },
];

const spaceOf = (spaceId: string) =>
  spaces.get(spaceId) ??
  spaces.set(spaceId, { projects: [], isMigrated: false }).get(spaceId)!;

function add(
  spaceId: string,
  path: string,
  name = path.replace(/\/+$/, '').split('/').pop() || path,
  origin: string | null = null,
) {
  const space = spaceOf(spaceId);
  const listed = space.projects.find((p) => p.path === path);
  if (listed) return listed;
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    path,
    origin,
    addedAt: Date.now(),
    iconMode: 'auto',
    icon: null,
    favicon: null,
    isMissing: false,
  };
  space.projects = [...space.projects, project];
  changeListeners.forEach((l) => l(spaceId));
  return project;
}

function update(spaceId: string, id: string, patch: Partial<Project> | null) {
  const space = spaceOf(spaceId);
  if (!space.projects.some((p) => p.id === id))
    throw new Error('That project isn’t in the list any more');
  space.projects = patch
    ? space.projects.map((p) => (p.id === id ? { ...p, ...patch } : p))
    : space.projects.filter((p) => p.id !== id);
  changeListeners.forEach((l) => l(spaceId));
  return space.projects.find((p) => p.id === id)!;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const projects: ProjectsHost = {
  async list(spaceId) {
    return spaceOf(spaceId).projects;
  },
  async migrate(spaceId, paths) {
    const space = spaceOf(spaceId);
    if (!space.isMigrated) {
      space.isMigrated = true;
      [...new Set(paths)].forEach((path) => add(spaceId, path));
    }
    return space.projects;
  },
  async addFolder(spaceId, path) {
    return add(spaceId, path);
  },
  async clone(spaceId, source, { parentDir, opId }) {
    const origin =
      'url' in source
        ? normalizeOrigin(source.url)
        : `github.com/${source.github}`;
    if (!origin)
      throw new Error(
        `${'url' in source ? source.url : source.github} isn’t a git URL Mochi can clone: use https://…, ssh://… or git@host:owner/repo`,
      );
    const name = repoName(origin);
    for (const pct of [0, 35, 70, 100]) {
      progressListeners.forEach((l) =>
        l({
          opId,
          line: `Receiving objects: ${String(pct).padStart(3)}% (${pct * 12}/1200)`,
        }),
      );
      await wait(250);
    }
    return add(
      spaceId,
      `${parentDir.replace(/\/+$/, '')}/${name}`,
      name,
      origin,
    );
  },
  async create(spaceId, name, { parentDir }) {
    return add(spaceId, `${parentDir.replace(/\/+$/, '')}/${name}`, name);
  },
  async rename(spaceId, id, name) {
    update(spaceId, id, { name });
  },
  async remove(spaceId, id) {
    update(spaceId, id, null);
  },
  async relocate(spaceId, id, path) {
    return update(spaceId, id, { path, isMissing: false });
  },
  async setIcon(spaceId, id, icon) {
    if (icon === 'auto' || icon === 'none')
      return update(spaceId, id, { iconMode: icon, icon: null });
    return update(spaceId, id, {
      iconMode: 'custom',
      icon: { url: icon, source: 'custom' },
    });
  },
  async githubRepos() {
    return REPOS;
  },
  onChange(listener) {
    changeListeners.add(listener);
    return () => void changeListeners.delete(listener);
  },
  onProgress(listener) {
    progressListeners.add(listener);
    return () => void progressListeners.delete(listener);
  },
};
