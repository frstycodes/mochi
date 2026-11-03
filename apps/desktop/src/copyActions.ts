import type { CloneSource } from '@mochi/domain/host/types/projects';
import { toast } from '@/toast/store';
import { host } from './host';
import type { ProjectCopy, ProjectWithCopies } from './projectCopies';
import { cloneProject } from './projects';
import { queryClient } from './query';
import { queryKeys } from './queryKeys';
import { startBlocker, type Computer } from './remote/computers';
import { useMachines } from './remote/useMachines';
import { useHarnessSelector } from './store';

/**
 * Putting a project on another computer, and taking a copy back out of it. Each runs on the computer that holds the folder:
 * a clone lands in that computer's projects folder, and a link is written to both copies' registries, so both computers
 * must be online.
 */
export function useCopyActions() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const { run, ask } = useMachines();

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
    const result = await run(computer.id, { type: 'clone-project', source });
    if (result.isOk) {
      toast.success(`Cloned ${project.name} on ${computer.name}`);
      refreshCatalog(computer.id);
    }
  };

  const writeLink = async (copy: ProjectCopy, linkId: string | null) => {
    if (copy.local) return host.projects.link(spaceId, copy.local.id, linkId);
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
        `Bring a computer with ${project.name} online to link it`,
      );
    const linkId = linked?.linkId ?? crypto.randomUUID();
    try {
      if (!linked) await writeLink(anchor, linkId);
      await writeLink(copy, linkId);
    } catch (error) {
      toast.error(`Couldn’t link ${copy.name}`, {
        description: (error as Error).message,
      });
    }
  };

  /** Undoes a link: the copy becomes its own project again (unless its remote still joins it). */
  const unlink = (copy: ProjectCopy) =>
    writeLink(copy, null).catch((error: unknown) =>
      toast.error(`Couldn’t unlink ${copy.name}`, {
        description: (error as Error).message,
      }),
    );

  return { clone, link, unlink };
}

/** GitHub as the computer's own gh login; any other host over HTTPS with that computer's git credentials. */
export function cloneSource(origin: string): CloneSource {
  return origin.startsWith('github.com/')
    ? { github: origin.slice('github.com/'.length) }
    : { url: `https://${origin}.git` };
}

/** A copy whose computer can take the link now: this computer's, else one online that lets this one manage it. */
function anchorCopy(project: ProjectWithCopies, computers: Computer[]) {
  return (
    project.copies.find((c) => c.machineId === null) ??
    project.copies.find((c) => {
      const computer = computers.find((k) => k.id === c.machineId);
      return !!computer && !startBlocker(computer);
    })
  );
}

function refreshCatalog(machineId: string) {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.remote.catalog(machineId, true),
  });
}
