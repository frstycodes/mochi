import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { normalizeOrigin } from '@mochi/domain/git/origin';
import type {
  Project,
  ProjectIconMode,
} from '@mochi/domain/host/types/projects';
import {
  customIconFile,
  findFavicon,
  iconUrl,
  removeCustomIcon,
  saveCustomIcon,
} from './icon.ts';
import { runGit } from '../git/run.ts';
import { readDoc, writeDoc } from '../store/client.ts';

/** `iconMode` is unset on rows saved before icons: those read as `auto`. `favoriteOrder` is unset on a project that isn't a favorite. */
type StoredProject = Omit<
  Project,
  'isMissing' | 'icon' | 'iconMode' | 'favicon' | 'favoriteOrder'
> & { iconMode?: ProjectIconMode; favoriteOrder?: number };

interface Saved {
  version: 1;
  /** Per profile (`Space.id`). `isMigrated` is set once the profile's old recents and thread folders were taken in. */
  spaces: Record<string, { projects: StoredProject[]; isMigrated: boolean }>;
}

export type ProjectRegistry = ReturnType<typeof projectRegistry>;

/**
 * Every profile's projects in one document of Core's `projects` table (`key`; tests use their own), uploaded icons in
 * `iconDir`. Changes run one at a time, each saved before the next starts.
 */
export function projectRegistry(iconDir: string, key = 'registry') {
  let saved: Promise<Saved> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const load = () => (saved ??= readDoc('projects', key).then(parseSaved));

  function change<T>(
    spaceId: string,
    edit: (space: Saved['spaces'][string]) => Promise<T>,
  ) {
    const next = queue.then(async () => {
      const data = await load();
      const space = (data.spaces[spaceId] ??= {
        projects: [],
        isMigrated: false,
      });
      const result = await edit(space);
      await writeDoc('projects', key, data);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  const find = (space: Saved['spaces'][string], id: string) => {
    const project = space.projects.find((p) => p.id === id);
    if (!project) throw new Error('That project isn’t in the list any more');
    return project;
  };

  async function list(spaceId: string) {
    await queue;
    return Promise.all(
      ((await load()).spaces[spaceId]?.projects ?? []).map(withOne),
    );
  }

  /** What the renderer gets: the folder's state and its icon, read now. */
  async function withOne(project: StoredProject): Promise<Project> {
    const iconMode = project.iconMode ?? 'auto';
    const isMissing = !(await isFolder(project.path));
    const favicon = isMissing ? null : await findFavicon(project.path);
    return {
      ...project,
      iconMode,
      favoriteOrder: project.favoriteOrder ?? null,
      isMissing,
      favicon,
      icon: isMissing ? null : await iconOf(project, iconMode, favicon),
    };
  }

  async function iconOf(
    project: StoredProject,
    mode: ProjectIconMode,
    favicon: string | null,
  ): Promise<Project['icon']> {
    if (mode === 'custom') {
      const custom = await customIconFile(iconDir, project.id);
      const url = custom && (await iconUrl(custom));
      return url ? { url, source: 'custom' } : null;
    }
    if (mode === 'none') return null;
    const url = favicon && (await iconUrl(join(project.path, favicon)));
    return url ? { url, source: 'favicon', file: favicon! } : null;
  }

  return {
    list,
    async migrate(spaceId: string, paths: string[]) {
      await change(spaceId, async (space) => {
        if (space.isMigrated) return;
        for (const path of new Set(
          paths.filter((p) => isAbsolute(p)).map((p) => resolve(p)),
        ))
          if (
            !space.projects.some((p) => p.path === path) &&
            (await isFolder(path))
          )
            space.projects.push(await newProject(path));
        space.isMigrated = true;
      });
      return list(spaceId);
    },
    /** `name` names a project created under it (a clone's repo name); otherwise the folder's own name. */
    async add(spaceId: string, path: string, name?: string) {
      const folder = await checkedFolder(path);
      return withOne(
        await change(spaceId, async (space) => {
          const listed = space.projects.find((p) => p.path === folder);
          if (listed) return listed;
          const project = await newProject(folder, name);
          space.projects.push(project);
          return project;
        }),
      );
    },
    rename(spaceId: string, id: string, name: string) {
      return change(
        spaceId,
        async (space) => void (find(space, id).name = name),
      );
    },
    remove(spaceId: string, id: string) {
      return change(spaceId, async (space) => {
        find(space, id);
        space.projects = space.projects.filter((p) => p.id !== id);
        await removeCustomIcon(iconDir, id);
      });
    },
    setFavorites(spaceId: string, ids: string[]) {
      return change(spaceId, async (space) => {
        const order = [...new Set(ids)];
        for (const id of order) find(space, id);
        for (const project of space.projects) {
          const place = order.indexOf(project.id);
          if (place < 0) delete project.favoriteOrder;
          else project.favoriteOrder = place;
        }
      });
    },
    async setIcon(spaceId: string, id: string, icon: string) {
      return withOne(
        await change(spaceId, async (space) => {
          const project = find(space, id);
          if (icon === 'auto' || icon === 'none') {
            await removeCustomIcon(iconDir, id);
            project.iconMode = icon;
          } else {
            await saveCustomIcon(iconDir, id, icon);
            project.iconMode = 'custom';
          }
          return project;
        }),
      );
    },
    async relocate(spaceId: string, id: string, path: string) {
      const folder = await checkedFolder(path);
      return withOne(
        await change(spaceId, async (space) => {
          const project = find(space, id);
          const other = space.projects.find(
            (p) => p.path === folder && p.id !== id,
          );
          if (other)
            throw new Error(`${folder} is already the project ${other.name}`);
          const origin = await originOf(folder);
          if (project.origin && origin !== project.origin)
            throw new Error(
              `${folder} is ${origin ? `a clone of ${origin}` : 'not a clone'}, not ${project.origin}`,
            );
          project.path = folder;
          project.origin = origin;
          return project;
        }),
      );
    },
  };
}

/** `origin` of the repo at `path`, normalised; null for a folder without one. */
export async function originOf(path: string) {
  const url = await runGit(path, ['remote', 'get-url', 'origin']).catch(
    () => '',
  );
  return normalizeOrigin(url);
}

async function newProject(
  path: string,
  name = basename(path),
): Promise<StoredProject> {
  return {
    id: randomUUID(),
    name,
    path,
    origin: await originOf(path),
    addedAt: Date.now(),
  };
}

async function checkedFolder(path: string) {
  if (!isAbsolute(path)) throw new Error(`${path} isn’t a full path`);
  const folder = resolve(path);
  if (!(await isFolder(folder))) throw new Error(`${folder} isn’t a folder`);
  return folder;
}

const isFolder = (path: string) =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );

const emptySaved = (): Saved => ({ version: 1, spaces: {} });

/** A file from an older or hand-edited copy keeps only rows of the right shape. */
function parseSaved(value: unknown): Saved {
  const spaces = (value as Partial<Saved> | null)?.spaces;
  if (!spaces || typeof spaces !== 'object') return emptySaved();
  return {
    version: 1,
    spaces: Object.fromEntries(
      Object.entries(spaces).map(([id, space]) => [
        id,
        {
          isMigrated: space?.isMigrated === true,
          projects: Array.isArray(space?.projects)
            ? space.projects.filter(isStoredProject)
            : [],
        },
      ]),
    ),
  };
}

const ICON_MODES = [undefined, 'auto', 'custom', 'none'];

const isStoredProject = (
  p: Partial<StoredProject> | null,
): p is StoredProject =>
  typeof p?.id === 'string' &&
  typeof p.name === 'string' &&
  typeof p.path === 'string' &&
  (p.origin === null || typeof p.origin === 'string') &&
  typeof p.addedAt === 'number' &&
  ICON_MODES.includes(p.iconMode);
