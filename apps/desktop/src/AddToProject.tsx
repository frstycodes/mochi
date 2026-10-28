import { useState } from 'react';
import { FolderPlus } from '@/icons';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Thread } from './model';
import { MetaChip } from './MetaChip';
import {
  ProjectChooser,
  useProjectRows,
  type PickerProject,
} from './ProjectPicker';
import { useQuery } from '@tanstack/react-query';
import type { FollowedMachine } from './host/types/remote';
import { queryKeys } from './queryKeys';
import { useRemoteMachine } from './remote/origin';
import { useMachines } from './remote/useMachines';
import { refreshProjects } from './projects';
import { canAttach } from './store/threads';
import { useDispatch } from './store';

/** A folderless chat's way into a project: the session moves with it, so the next message carries on there. */
export function AddToProject({ thread }: { thread: Thread }) {
  const machine = useRemoteMachine();
  return machine ? (
    <RemoteAddToProject thread={thread} machine={machine} />
  ) : (
    <LocalAddToProject thread={thread} />
  );
}

function LocalAddToProject({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const projects = useProjectRows(thread.spaceId);
  return (
    <AddToProjectChip
      thread={thread}
      projects={projects}
      onOpen={() => refreshProjects(thread.spaceId)}
      onChoose={(project) =>
        dispatch({ type: 'attach-project', threadId: thread.id, project })
      }
    />
  );
}

/** Another computer's chat moves into one of that computer's projects, chosen by id; it never names a folder here. */
function RemoteAddToProject({
  thread,
  machine,
}: {
  thread: Thread;
  machine: FollowedMachine;
}) {
  const { run, ask } = useMachines();
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.machine(machine.id),
    queryFn: () => ask(machine.id, { type: 'projects' }),
    enabled: machine.status === 'online',
  });
  const projects = (projectsQuery.data ?? []).map((p) => ({
    ref: p.id,
    name: p.name,
    isMissing: p.isMissing,
    icon: p.icon,
    id: p.id,
  }));
  return (
    <AddToProjectChip
      thread={thread}
      projects={projects}
      machine={machine}
      onOpen={() => void projectsQuery.refetch()}
      onChoose={(project) =>
        void run(machine.id, {
          type: 'attach-project',
          threadId: thread.id,
          project,
        })
      }
    />
  );
}

function AddToProjectChip({
  thread,
  projects,
  machine,
  onOpen,
  onChoose,
}: {
  thread: Thread;
  projects: PickerProject[];
  machine?: FollowedMachine;
  onOpen: () => void;
  onChoose: (project: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const isIdle = canAttach(thread);

  const choose = (project: string | null) => {
    setOpen(false);
    if (project) onChoose(project);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) onOpen();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button gets no pointer events, so the tooltip hangs on its wrapper. */}
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <MetaChip disabled={!isIdle}>
                <FolderPlus />
                <span className="truncate">Add to project</span>
              </MetaChip>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {isIdle
            ? 'Move this chat into a project, keeping its session'
            : 'Available once the agent finishes this turn'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-0">
        <ProjectChooser
          value={null}
          projects={projects}
          machine={machine}
          placeholder="Move into a project"
          isProjectRequired
          onChoose={choose}
        />
      </PopoverContent>
    </Popover>
  );
}
