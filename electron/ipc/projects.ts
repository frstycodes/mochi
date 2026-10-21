import { app } from 'electron';
import { join } from 'node:path';
import type { CloneSource, ProjectsHost } from '../../src/host/types/projects.ts';
import { openWindows } from '../agents/events.ts';
import { githubAccount } from '../git/gh.ts';
import { adoptFolder, cloneProject, githubRepos, initProject, publishProject } from '../projects/add.ts';
import { projectRegistry } from '../projects/registry.ts';
import { record, string, type Handlers } from './handlers.ts';

const MAX_ID = 256;
const MAX_NAME = 100;
const VISIBILITIES = ['private', 'public'];

let registry: ReturnType<typeof projectRegistry> | undefined;
const store = () => (registry ??= projectRegistry(join(app.getPath('userData'), 'projects.json')));

/** Every window lists the registry, so each hears when a profile's list changes. */
const changed = (spaceId: string) => {
  for (const win of openWindows()) win.webContents.send('projects:onChange', spaceId);
};

async function changing<T>(spaceId: string, work: Promise<T>) {
  try {
    return await work;
  } finally {
    changed(spaceId);
  }
}

export const projects = {
  async list(_sender, spaceId) {
    return store().list(space(spaceId));
  },
  async migrate(_sender, spaceId, paths) {
    if (!Array.isArray(paths) || paths.length > 1000) throw new TypeError('paths must be a list of up to 1000 folders');
    const id = space(spaceId);
    return changing(id, store().migrate(id, paths.map((p, i) => string(p, `paths[${i}]`))));
  },
  async addFolder(_sender, spaceId, path) {
    const id = space(spaceId);
    return changing(id, store().add(id, string(path, 'path')));
  },
  async adopt(_sender, spaceId, path, options) {
    const id = space(spaceId);
    const o = record(options, 'options');
    if (o.transfer !== undefined && o.transfer !== 'move' && o.transfer !== 'copy') throw new TypeError('options.transfer must be move or copy');
    const from = o.from === undefined ? undefined : string(o.from, 'options.from');
    const folder = await adoptFolder(string(path, 'path'), from, (o.transfer as 'move' | 'copy' | undefined) ?? 'copy', o.gitInit === true);
    return changing(id, store().add(id, folder));
  },
  async clone(sender, spaceId, source, options) {
    const id = space(spaceId);
    const o = record(options, 'options');
    const opId = string(o.opId, 'opId', MAX_ID);
    const where = await cloneProject(cloneSource(source), string(o.parentDir, 'parentDir'), githubAccount(o.githubUser), (line) => {
      if (!sender.isDestroyed()) sender.send('projects:onProgress', { opId, line });
    });
    return changing(id, store().add(id, where.path, where.name));
  },
  async create(_sender, spaceId, name, options) {
    const id = space(spaceId);
    const o = record(options, 'options');
    const projectName = string(name, 'name', MAX_NAME);
    if (o.publish !== undefined && !VISIBILITIES.includes(o.publish as string)) throw new TypeError('publish must be private or public');
    const account = githubAccount(o.githubUser);
    const path = await initProject(string(o.parentDir, 'parentDir'), projectName);
    const project = await changing(id, store().add(id, path));
    if (!o.publish) return project;
    try {
      await publishProject(path, projectName, o.publish as 'private' | 'public', account);
    } catch (error) {
      throw new Error(`Created ${path}, but publishing to GitHub failed: ${(error as Error).message}`, { cause: error });
    }
    return changing(id, store().relocate(id, project.id, path));
  },
  async rename(_sender, spaceId, projectId, name) {
    const id = space(spaceId);
    const trimmed = string(name, 'name', MAX_NAME).trim();
    if (!trimmed) throw new TypeError('A project needs a name');
    await changing(id, store().rename(id, string(projectId, 'id', MAX_ID), trimmed));
  },
  async remove(_sender, spaceId, projectId) {
    const id = space(spaceId);
    await changing(id, store().remove(id, string(projectId, 'id', MAX_ID)));
  },
  async relocate(_sender, spaceId, projectId, path) {
    const id = space(spaceId);
    return changing(id, store().relocate(id, string(projectId, 'id', MAX_ID), string(path, 'path')));
  },
  async setIcon(_sender, spaceId, projectId, icon) {
    const id = space(spaceId);
    // A data URL of an icon at its 512 KB cap, base64, with room for its header.
    return changing(id, store().setIcon(id, string(projectId, 'id', MAX_ID), string(icon, 'icon', 720 * 1024)));
  },
  async githubRepos(_sender, githubUser) {
    return githubRepos(githubAccount(githubUser));
  },
} satisfies Handlers<ProjectsHost>;

const space = (value: unknown) => string(value, 'spaceId', MAX_ID);

function cloneSource(value: unknown): CloneSource {
  const s = record(value, 'source');
  if (typeof s.url === 'string') return { url: string(s.url, 'source.url') };
  if (typeof s.github === 'string') return { github: string(s.github, 'source.github', 200) };
  throw new TypeError('source must be { url } or { github }');
}
