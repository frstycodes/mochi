import { useQuery } from '@tanstack/react-query';
import type { Project } from '@mochi/domain/host/types/projects';
import { plural } from '@mochi/domain/lib/format';
import { copyStatus } from './git/copyStatus';
import type { CatalogProject, CopyStatus } from './host/types/remote';
import { useProjects } from './projects';
import { queryKeys } from './queryKeys';
import { useLastKnownCatalogs, useMachines } from './remote/useMachines';
import { useSpaceThreads } from './store';

/**
 * Every project you work in, across your computers: this computer's registry plus each followed computer's last catalog,
 * joined by git remote. This computer's projects come first in their own order, then the ones only another computer holds.
 */
export function useProjectsWithCopies(
  spaceId: string,
): ProjectWithCopies[] | null {
  const local = useProjects(spaceId, useSpaceThreads());
  const catalogs = useLastKnownCatalogs(
    useMachines().machines.map((m) => m.machine),
  );
  return (
    local &&
    joinCopies(
      local,
      catalogs.map(({ machine, catalog }) => ({
        machineId: machine.id,
        projects: catalog?.projects ?? [],
      })),
    )
  );
}

/** A project across your computers, its copies in the order they joined: this computer's first. */
export interface ProjectWithCopies {
  /** Stable while its first copy stays: that copy's computer and ref. */
  key: string;
  name: string;
  origin: string | null;
  icon: Project['icon'];
  copies: ProjectCopy[];
}

/** One folder holding a project on one computer (`machineId` null: this one). `ref` is what a thread there starts in. */
export interface ProjectCopy {
  machineId: string | null;
  ref: string;
  name: string;
  /** This computer's registry entry; its git state is read here (`useCopyStatus`). */
  local?: Project;
  /** Another computer's git state as its catalog last reported it; null when the folder isn't a repo. */
  status?: CopyStatus | null;
}

/**
 * Folders with the same normalised remote are one project, at most one copy per computer: a second clone on the same
 * computer stays its own project. Folders without a remote are never joined.
 */
export function joinCopies(
  local: readonly Project[],
  others: readonly {
    machineId: string;
    projects: readonly CatalogProject[];
  }[],
): ProjectWithCopies[] {
  const joined: ProjectWithCopies[] = [];
  const byOrigin = new Map<string, ProjectWithCopies>();
  const add = (
    copy: ProjectCopy,
    origin: string | null,
    icon: Project['icon'],
  ) => {
    const same = origin === null ? undefined : byOrigin.get(origin);
    if (same && !same.copies.some((c) => c.machineId === copy.machineId)) {
      same.copies.push(copy);
      return;
    }
    const project = {
      key: `${copy.machineId ?? HERE}:${copy.ref}`,
      name: copy.name,
      origin,
      icon,
      copies: [copy],
    };
    joined.push(project);
    if (origin !== null && !same) byOrigin.set(origin, project);
  };
  for (const p of local)
    add(
      { machineId: null, ref: p.path, name: p.name, local: p },
      p.origin,
      p.icon,
    );
  for (const { machineId, projects } of others)
    for (const p of projects)
      add(
        { machineId, ref: p.ref, name: p.name, status: p.copy ?? null },
        p.origin ?? null,
        p.icon ?? null,
      );
  return joined;
}

const HERE = 'here';

/** The project holding the copy at `ref` on that computer. */
export function projectOf(
  projects: readonly ProjectWithCopies[],
  machineId: string | null,
  ref: string | null,
) {
  return ref === null
    ? undefined
    : projects.find((p) =>
        p.copies.some((c) => c.machineId === machineId && c.ref === ref),
      );
}

/** A copy's git state: read here for this computer's own, from its catalog for another's; undefined while it's read. */
export function useCopyStatus(copy: ProjectCopy | undefined) {
  const path = copy?.local && !copy.local.isMissing ? copy.local.path : null;
  const statusQuery = useQuery({
    queryKey: queryKeys.git.copyStatus(path ?? ''),
    queryFn: () => copyStatus(path!),
    enabled: path !== null,
  });
  return copy?.local ? statusQuery.data : copy?.status;
}

/** A copy's state as words, measured against its remote by name ("GitHub"); the branch is shown beside it, not in it. */
export function copyFact(
  status: CopyStatus | null,
  origin: string | null,
): string {
  if (status === null) return 'Plain folder, no git';
  const remote = remoteName(origin);
  if (!status.upstream) return `Not pushed to ${remote}`;
  const { ahead, behind } = status.upstream;
  const parts = [
    behind > 0 &&
      `${plural(behind, '1 commit', `${behind} commits`)} to pull from ${remote}`,
    ahead > 0 && `${plural(ahead, '1 commit', `${ahead} commits`)} not pushed`,
    status.changed > 0 &&
      plural(
        status.changed,
        '1 changed file',
        `${status.changed} changed files`,
      ),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : `Up to date with ${remote}`;
}

function remoteName(origin: string | null) {
  if (origin?.startsWith('github.com/')) return 'GitHub';
  if (origin?.startsWith('gitlab.com/')) return 'GitLab';
  return 'origin';
}
