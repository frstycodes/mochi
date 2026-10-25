import { join } from 'node:path';
import type { ProjectsHost } from '@mochi/domain/host/types/projects';
import { push } from '../agents/events.ts';
import { githubAccount } from '../git/gh.ts';
import {
  cloneProject,
  githubRepos,
  initProject,
  publishProject,
} from './add.ts';
import { projectRegistry } from './registry.ts';
import type { HostMethods } from '../hostMethods.ts';

/** `host.projects`, its uploaded icons under `userData`. */
export const projectsHost = (userData: string) => {
  const registry = projectRegistry(join(userData, 'project-icons'));
  return {
    async list(_caller, spaceId) {
      return registry.list(spaceId);
    },
    async migrate(_caller, spaceId, paths) {
      return changing(spaceId, registry.migrate(spaceId, paths));
    },
    async addFolder(_caller, spaceId, path) {
      return changing(spaceId, registry.add(spaceId, path));
    },
    async clone({ windowId }, spaceId, source, options) {
      const { opId } = options;
      const where = await cloneProject(
        source,
        options.parentDir,
        githubAccount(options.githubUser),
        (line) =>
          push({
            channel: 'projects:onProgress',
            payload: { opId, line },
            windowId,
          }),
      );
      return changing(spaceId, registry.add(spaceId, where.path, where.name));
    },
    async create(_caller, spaceId, name, options) {
      const account = githubAccount(options.githubUser);
      const path = await initProject(options.parentDir, name);
      const project = await changing(spaceId, registry.add(spaceId, path));
      if (!options.publish) return project;
      try {
        await publishProject(path, name, options.publish, account);
      } catch (error) {
        throw new Error(
          `Created ${path}, but publishing to GitHub failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
      return changing(spaceId, registry.relocate(spaceId, project.id, path));
    },
    async rename(_caller, spaceId, projectId, name) {
      await changing(spaceId, registry.rename(spaceId, projectId, name.trim()));
    },
    async remove(_caller, spaceId, projectId) {
      await changing(spaceId, registry.remove(spaceId, projectId));
    },
    async relocate(_caller, spaceId, projectId, path) {
      return changing(spaceId, registry.relocate(spaceId, projectId, path));
    },
    async setIcon(_caller, spaceId, projectId, icon) {
      return changing(spaceId, registry.setIcon(spaceId, projectId, icon));
    },
    async githubRepos(_caller, githubUser) {
      return githubRepos(githubAccount(githubUser));
    },
  } satisfies HostMethods<ProjectsHost>;
};

/** Every window lists the registry, so each hears when a profile's list changes. */
async function changing<T>(spaceId: string, work: Promise<T>) {
  try {
    return await work;
  } finally {
    push({ channel: 'projects:onChange', payload: spaceId });
  }
}
