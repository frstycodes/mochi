import { useQuery } from '@tanstack/react-query';
import type { Project } from '@mochi/domain/host/types/projects';
import { plural } from '@mochi/domain/lib/format';
import { copyStatus } from './git/copyStatus';
import type { CatalogProject, CopyStatus } from './host/types/remote';
import type { Thread } from './model';
import { projectRef } from './projectRef';
import { useProjects } from './projects';
import { queryKeys } from './queryKeys';
import { parseRemoteThreadId } from './remote/ids';
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
  /** Stable as copies come and go: its remote, else its link, else its first copy (`withStableKeys`). */
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
  origin: string | null;
  /** Set when it was linked to the others by hand. */
  linkId?: string;
  icon: Project['icon'];
  /** This computer's registry entry; its git state is read here (`useCopyStatus`). */
  local?: Project;
  /** Another computer's git state as its catalog last reported it; null when the folder isn't a repo. */
  status?: CopyStatus | null;
}

/**
 * Folders linked by hand, or with the same normalised remote, are one project, at most one copy per computer: a second
 * clone on the same computer stays its own project. A copy that matches two projects joins them, unless both have a copy
 * on one computer. Folders without a remote join only by hand.
 */
export function joinCopies(
  local: readonly Project[],
  others: readonly {
    machineId: string;
    projects: readonly CatalogProject[];
  }[],
): ProjectWithCopies[] {
  const joined: ProjectWithCopies[] = [];
  const byKey = new Map<string, ProjectWithCopies>();
  const add = (copy: ProjectCopy) => {
    const keys = joinKeys(copy);
    // Earliest first, so a merge keeps this computer's copy and the list's order.
    const matches = [...new Set(keys.flatMap((k) => byKey.get(k) ?? []))]
      .filter((p) => !holds(p, copy.machineId))
      .sort((a, b) => joined.indexOf(a) - joined.indexOf(b));
    const [project = newProject(copy), ...rest] = matches;
    if (matches.length === 0) joined.push(project);
    for (const other of rest) {
      if (other.copies.some((c) => holds(project, c.machineId))) continue;
      project.copies.push(...other.copies);
      joined.splice(joined.indexOf(other), 1);
      for (const [k, p] of byKey) if (p === other) byKey.set(k, project);
    }
    if (project.copies[0] !== copy) project.copies.push(copy);
    project.origin ??= copy.origin;
    for (const k of keys) if (!byKey.has(k)) byKey.set(k, project);
  };
  for (const p of local)
    add({
      machineId: null,
      ref: p.path,
      name: p.name,
      origin: p.origin,
      ...(p.linkId && { linkId: p.linkId }),
      icon: p.icon,
      local: p,
    });
  for (const { machineId, projects } of others)
    for (const p of projects)
      add({
        machineId,
        ref: p.ref,
        name: p.name,
        origin: p.origin ?? null,
        ...(p.linkId && { linkId: p.linkId }),
        icon: p.icon ?? null,
        status: p.copy ?? null,
      });
  return withStableKeys(joined);
}

/**
 * Keyed by what joins it (its remote, else its link), so the key survives a copy joining ahead of the first (a clone
 * here). A second project with the same remote, or one with neither, keeps its first copy's key.
 */
function withStableKeys(projects: ProjectWithCopies[]) {
  const taken = new Set<string>();
  for (const project of projects) {
    const linkId = project.copies.find((c) => c.linkId)?.linkId;
    const joinedBy = project.origin
      ? `origin:${project.origin}`
      : linkId && `link:${linkId}`;
    if (joinedBy && !taken.has(joinedBy)) project.key = joinedBy;
    taken.add(project.key);
  }
  return projects;
}

const joinKeys = ({ linkId, origin }: ProjectCopy) => [
  ...(linkId ? [`link:${linkId}`] : []),
  ...(origin ? [`origin:${origin}`] : []),
];

const holds = (project: ProjectWithCopies, machineId: string | null) =>
  project.copies.some((c) => c.machineId === machineId);

function newProject(copy: ProjectCopy): ProjectWithCopies {
  return {
    key: `${copy.machineId ?? HERE}:${copy.ref}`,
    name: copy.name,
    origin: copy.origin,
    icon: copy.icon,
    copies: [copy],
  };
}

/** Linked by hand, but its remote isn't the project's: worth a warning wherever it shows, never a block. */
export function isOtherRepo(copy: ProjectCopy, project: ProjectWithCopies) {
  return (
    copy.origin !== null &&
    project.origin !== null &&
    copy.origin !== project.origin
  );
}

const HERE = 'here';

/**
 * The project a thread works in, as a `ProjectWithCopies.key`, so one repo's threads on every computer group as one; a
 * folder no project lists keys by its computer and folder. Null for a folderless chat.
 */
export function threadProjectKey(
  thread: Pick<Thread, 'id' | 'repo'>,
  projects: readonly ProjectWithCopies[],
): string | null {
  const ref = projectRef(thread.repo);
  if (!thread.repo || !ref) return null;
  const machineId = parseRemoteThreadId(thread.id)?.machineId ?? null;
  // GAP: another computer's thread carries its folder there, not its catalog id; the copy there of the same name stands in.
  const { project } = thread.repo;
  const isCopy = (c: ProjectCopy) =>
    c.machineId === machineId &&
    (machineId === null ? c.ref === ref : c.name === project);
  const joined = projects.find((p) => p.copies.some(isCopy));
  return joined?.key ?? `${machineId ?? HERE}:${ref}`;
}

/** `threadProjectKey` over this profile's projects as they join now. */
export function useThreadProjectKey(spaceId: string) {
  const projects = useProjectsWithCopies(spaceId) ?? [];
  return {
    keyOf: (thread: Pick<Thread, 'id' | 'repo'>) =>
      threadProjectKey(thread, projects),
    nameOf: (key: string) => projects.find((p) => p.key === key)?.name,
  };
}

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
