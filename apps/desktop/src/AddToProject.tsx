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
import { ProjectChooser, useProjectRows } from './ProjectPicker';
import { refreshProjects } from './projects';
import { canAttach } from './store/threads';
import { useDispatch } from './store';

/** A folderless chat's way into a project: the session moves with it, so the next message carries on there. */
export function AddToProject({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const projects = useProjectRows(thread.spaceId);
  const [isOpen, setOpen] = useState(false);
  const isIdle = canAttach(thread);

  const choose = (project: string | null) => {
    setOpen(false);
    if (project)
      dispatch({ type: 'attach-project', threadId: thread.id, project });
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) refreshProjects(thread.spaceId);
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
          placeholder="Move into a project"
          isProjectRequired
          onChoose={choose}
        />
      </PopoverContent>
    </Popover>
  );
}
