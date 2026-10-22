import { app } from 'electron';
import { join } from 'node:path';
import type { ProjectsHost } from '../../src/host/types/projects.ts';
import { openWindows } from '../agents/events.ts';
import { githubAccount } from '../git/gh.ts';
import { cloneProject, githubRepos, initProject, publishProject } from '../projects/add.ts';
import { projectRegistry } from '../projects/registry.ts';
import type { Handlers } from './handlers.ts';

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
    return store().list(spaceId);
  },
  async migrate(_sender, spaceId, paths) {
    return changing(spaceId, store().migrate(spaceId, paths));
  },
  async addFolder(_sender, spaceId, path) {
    return changing(spaceId, store().add(spaceId, path));
  },
  async clone(sender, spaceId, source, options) {
    const { opId } = options;
    const where = await cloneProject(source, options.parentDir, githubAccount(options.githubUser), (line) => {
      if (!sender.isDestroyed()) sender.send('projects:onProgress', { opId, line });
    });
    return changing(spaceId, store().add(spaceId, where.path, where.name));
  },
  async create(_sender, spaceId, name, options) {
    const account = githubAccount(options.githubUser);
    const path = await initProject(options.parentDir, name);
    const project = await changing(spaceId, store().add(spaceId, path));
    if (!options.publish) return project;
    try {
      await publishProject(path, name, options.publish, account);
    } catch (error) {
      throw new Error(`Created ${path}, but publishing to GitHub failed: ${(error as Error).message}`, { cause: error });
    }
    return changing(spaceId, store().relocate(spaceId, project.id, path));
  },
  async rename(_sender, spaceId, projectId, name) {
    await changing(spaceId, store().rename(spaceId, projectId, name.trim()));
  },
  async remove(_sender, spaceId, projectId) {
    await changing(spaceId, store().remove(spaceId, projectId));
  },
  async relocate(_sender, spaceId, projectId, path) {
    return changing(spaceId, store().relocate(spaceId, projectId, path));
  },
  async setIcon(_sender, spaceId, projectId, icon) {
    return changing(spaceId, store().setIcon(spaceId, projectId, icon));
  },
  async githubRepos(_sender, githubUser) {
    return githubRepos(githubAccount(githubUser));
  },
} satisfies Handlers<ProjectsHost>;
