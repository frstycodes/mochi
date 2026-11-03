import { useQuery } from '@tanstack/react-query';
import type { CloneSource } from '@mochi/domain/host/types/projects';
import { toast } from '@/toast/store';
import { syncCopy, type SyncDirection } from './git/copyStatus';
import { host } from './host';
import type { CopyStatus, MailCommand, QueuedMail } from './host/types/remote';
import type { ProjectCopy, ProjectWithCopies } from './projectCopies';
import { cloneProject, githubUserOf } from './projects';
import { queryClient } from './query';
import { queryKeys } from './queryKeys';
import { startBlocker, type Computer } from './remote/computers';
import { useMachines } from './remote/useMachines';
import { useHarnessSelector } from './store';

/**
 * Putting a project on another computer, and taking a copy back out of it. Each runs on the computer that holds the folder:
 * a clone lands in that computer's projects folder, and a link is written to both copies' registries. A computer that's
 * offline gets it by mail (`remote.queueMail`), run when it next connects.
 */
export function useCopyActions() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const { run, ask } = useMachines();

  /** Queued for an offline computer; resolves once the relay holds it. */
  const queue = async (computer: Computer, command: MailCommand) => {
    await host.remote.queueMail(computer.id!, command);
    void queryClient.invalidateQueries({ queryKey: queryKeys.remote.outbox() });
  };

  /** Cloned from the project's remote, so it joins by remote with nothing to link. */
  const clone = async (project: ProjectWithCopies, computer: Computer) => {
    const source = cloneSource(project.origin!);
    if (!computer.id)
      return cloneProject(spaceId, source).then(
        (p) => toast.success(`Cloned ${p.name}`),
        (error: unknown) =>
          toast.error(`Couldn’t clone ${project.name}`, {
            description: (error as Error).message,
          }),
      );
    if (isAway(computer))
      return queue(computer, { type: 'clone-project', source }).then(
        () =>
          toast(`${project.name} clones when ${computer.name} is back online`),
        (error: unknown) =>
          toast.error(`Couldn’t queue ${project.name} for ${computer.name}`, {
            description: (error as Error).message,
          }),
      );
    const result = await run(computer.id, { type: 'clone-project', source });
    if (result.isOk) {
      toast.success(`Cloned ${project.name} on ${computer.name}`);
      refreshCatalog(computer.id);
    }
  };

  const writeLink = async (
    copy: ProjectCopy,
    linkId: string | null,
    computers: Computer[],
  ) => {
    if (copy.local) return host.projects.link(spaceId, copy.local.id, linkId);
    const computer = computers.find((c) => c.id === copy.machineId);
    if (computer && isAway(computer))
      return queue(computer, {
        type: 'link-project',
        project: copy.ref,
        linkId,
      });
    // `ask`, not `run`: the caller toasts once for the whole link, whichever side failed.
    await ask(copy.machineId!, {
      type: 'link-project',
      project: copy.ref,
      linkId,
    });
    refreshCatalog(copy.machineId!);
  };

  /** `copy`, one of another project's, becomes this project's copy on its computer. */
  const link = async (
    project: ProjectWithCopies,
    copy: ProjectCopy,
    computers: Computer[],
  ) => {
    const linked = project.copies.find((c) => !!c.linkId);
    const anchor = linked ?? anchorCopy(project, computers);
    if (!anchor)
      return void toast.error(
        `None of the computers with ${project.name} lets this one change it`,
      );
    const linkId = linked?.linkId ?? crypto.randomUUID();
    try {
      if (!linked) await writeLink(anchor, linkId, computers);
      await writeLink(copy, linkId, computers);
    } catch (error) {
      toast.error(`Couldn’t link ${copy.name}`, {
        description: (error as Error).message,
      });
    }
  };

  /** Undoes a link: the copy becomes its own project again (unless its remote still joins it). */
  const unlink = (copy: ProjectCopy, computers: Computer[]) =>
    writeLink(copy, null, computers).catch((error: unknown) =>
      toast.error(`Couldn’t unlink ${copy.name}`, {
        description: (error as Error).message,
      }),
    );

  /** Pull or Push, run on the computer that holds the copy; another computer asks you first before it pushes. */
  const sync = async (copy: ProjectCopy, direction: SyncDirection) => {
    if (!copy.local) {
      const result = await run(copy.machineId!, {
        type: 'sync-project',
        project: copy.ref,
        direction,
      });
      if (result.isOk) refreshCatalog(copy.machineId!);
      return;
    }
    const { path } = copy.local;
    await syncCopy(path, direction, githubUserOf(spaceId)).then(
      (detail) => toast.success(detail),
      (error: unknown) =>
        toast.error(`Couldn’t ${direction} ${copy.name}`, {
          description: (error as Error).message,
        }),
    );
    void queryClient.invalidateQueries({
      queryKey: queryKeys.git.copyStatus(path),
    });
  };

  /**
   * Put on GitHub, run where the folder is, as that computer's GitHub login; then, if asked, a clone onto each computer in
   * `cloneTo` (by mail for one that's offline). Resolves to the new origin, or undefined when it didn't happen.
   */
  const publish = async (
    project: ProjectWithCopies,
    copy: ProjectCopy,
    {
      name,
      visibility,
      cloneTo,
    }: { name: string; visibility: 'private' | 'public'; cloneTo: Computer[] },
  ) => {
    const origin = await publishCopy(copy, name, visibility);
    if (!origin) return undefined;
    toast.success(`${project.name} is on GitHub`, { description: origin });
    for (const computer of cloneTo)
      await clone({ ...project, origin }, computer);
    return origin;
  };

  async function publishCopy(
    copy: ProjectCopy,
    name: string,
    visibility: 'private' | 'public',
  ) {
    if (!copy.local) {
      const result = await run(copy.machineId!, {
        type: 'publish-project',
        project: copy.ref,
        name,
        visibility,
      });
      if (!result.isOk) return undefined;
      refreshCatalog(copy.machineId!);
      return result.detail;
    }
    return host.projects
      .publish(spaceId, copy.local.id, name, visibility, githubUserOf(spaceId))
      .then(
        (published) => published.origin ?? undefined,
        (error: unknown) =>
          void toast.error(`Couldn’t put ${copy.name} on GitHub`, {
            description: (error as Error).message,
          }),
      );
  }

  return { clone, link, unlink, sync, publish };
}

/** A repository name from a folder's: what GitHub accepts, the rest dashed. */
export const repoNameFor = (folder: string) =>
  folder.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'project';

/** The one git action a copy needs: Pull when it's only behind (a fast-forward), Push when it has commits of its own. */
export function syncNeed(status: CopyStatus | null | undefined) {
  const upstream = status?.upstream;
  if (!upstream) return null;
  if (upstream.ahead > 0) return 'push';
  if (upstream.behind > 0) return 'pull';
  return null;
}

/** GitHub as the computer's own gh login; any other host over HTTPS with that computer's git credentials. */
export function cloneSource(origin: string): CloneSource {
  return origin.startsWith('github.com/')
    ? { github: origin.slice('github.com/'.length) }
    : { url: `https://${origin}.git` };
}

/** A copy whose computer can take the link now: this computer's, else one online that lets this one manage it. */
function anchorCopy(project: ProjectWithCopies, computers: Computer[]) {
  const computerOf = (c: ProjectCopy) =>
    computers.find((k) => k.id === c.machineId);
  return (
    project.copies.find((c) => c.machineId === null) ??
    project.copies.find((c) => {
      const computer = computerOf(c);
      return !!computer && !startBlocker(computer);
    }) ??
    project.copies.find((c) => {
      const computer = computerOf(c);
      return !!computer && !copyBlocker(computer);
    })
  );
}

/** Not online now, so what it's sent goes by mail. */
export const isAway = (computer: Computer) =>
  !!computer.machine && computer.machine.status !== 'online';

/**
 * Why a clone or link can't go to that computer; undefined when it can, now or by mail once it's back. Only a pairing that
 * withholds `manage` stops it.
 */
export function copyBlocker(computer: Computer) {
  const { machine } = computer;
  if (!machine || machine.scopes.includes('manage')) return undefined;
  // A computer that never welcomed this one has no scopes yet: mail waits for it the same way.
  if (machine.scopes.length === 0) return undefined;
  return `${machine.name} doesn’t let this computer change its projects`;
}

/** The clone of this project waiting for that computer, if one is queued. */
export function queuedClone(
  outbox: readonly QueuedMail[],
  project: ProjectWithCopies,
  computer: Computer,
) {
  if (!project.origin) return undefined;
  const wanted = JSON.stringify(cloneSource(project.origin));
  return outbox.find(
    (m) =>
      m.machineId === computer.id &&
      m.command.type === 'clone-project' &&
      JSON.stringify(m.command.source) === wanted,
  );
}

/** What this computer queued for others; refreshed after each queue or cancel. */
export function useOutbox() {
  const outboxQuery = useQuery({
    queryKey: queryKeys.remote.outbox(),
    queryFn: () => host.remote.outbox(),
  });
  return {
    outbox: outboxQuery.data ?? NO_MAIL,
    cancel: (mail: QueuedMail) =>
      host.remote
        .cancelMail(mail.machineId, mail.id)
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.remote.outbox(),
          }),
        )
        .catch((error: unknown) =>
          toast.error('Couldn’t take it back', {
            description: (error as Error).message,
          }),
        ),
  };
}

const NO_MAIL: QueuedMail[] = [];

function refreshCatalog(machineId: string) {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.remote.catalog(machineId, true),
  });
}
