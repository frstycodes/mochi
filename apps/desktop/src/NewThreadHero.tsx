import type { ReactNode } from 'react';
import { Bug, CheckCircle, Cpu, Eye, FolderPlus, Pencil } from '@/icons';
import type { IconComponent } from '@/icons';
import { Button } from '@/components/ui/button';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { openSettings } from './routes/nav';
import type { Thread } from './model';
import { useThreadProjectKey } from './projectCopies';
import { ThreadItem } from './Sidebar';
import { useHarnessSelector, useSpaceListing } from './store';
import { useOpenThread } from './goals/SubThreads';

export function heroTitle(projectName: string | null) {
  return projectName
    ? `What should we build on ${projectName}?`
    : 'What should we build?';
}

export function HeroRows({
  projectKey,
  isDirty,
  onStarter,
}: {
  /** `ProjectWithCopies.key`: its threads on every computer are recent here. */
  projectKey: string | null;
  isDirty: boolean;
  onStarter: (prompt: string) => void;
}) {
  const threads = useProjectThreads(projectKey).slice(0, 3);
  const openThread = useOpenThread();
  const starters = STARTERS.filter((s) => !s.needsDirty || isDirty);
  return (
    <div className="flex flex-col gap-6">
      {threads.length > 0 && (
        <RowGroup label="Recent in this project">
          <SidebarMenu className="gap-0.5">
            {threads.map((t) => (
              <SidebarMenuItem key={t.id}>
                <ThreadItem
                  thread={t}
                  isActive={false}
                  isProjectHidden
                  onSelect={() => openThread(t)}
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </RowGroup>
      )}
      <RowGroup label="Start with">
        <ul className="flex flex-col">
          {starters.map((s) => (
            <StarterRow
              key={s.label}
              icon={s.icon}
              label={s.label}
              onClick={() => onStarter(s.prompt)}
            />
          ))}
        </ul>
      </RowGroup>
    </div>
  );
}

/** A space with no threads yet: the three things that make the first one work, each done in place. */
export function FirstRun({
  hasProject,
  onAddProject,
}: {
  hasProject: boolean;
  onAddProject: () => void;
}) {
  return (
    <RowGroup label="Getting started">
      <ol className="flex flex-col">
        <FirstRunStep
          icon={FolderPlus}
          isDone={hasProject}
          title="Add a project"
          detail="A folder or a GitHub repo. Threads run in their own worktree, so your checkout stays untouched."
          action={
            hasProject ? undefined : { label: 'Add project', run: onAddProject }
          }
        />
        <FirstRunStep
          icon={Cpu}
          title="Check your agents"
          detail="Mochi drives Claude Code and Codex with your own logins. Install and sign in to at least one."
          action={{
            label: 'Open Harnesses',
            run: () => openSettings('harnesses'),
          }}
        />
        <FirstRunStep
          icon={Pencil}
          title="Start your first thread"
          detail="Type above. When the agent needs you, it waits in Queue instead of guessing."
        />
      </ol>
    </RowGroup>
  );
}

function FirstRunStep({
  icon: Icon,
  isDone = false,
  title,
  detail,
  action,
}: {
  icon: IconComponent;
  isDone?: boolean;
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
}) {
  const Mark = isDone ? CheckCircle : Icon;
  return (
    <li className="flex items-start gap-3 rounded-md px-2 py-2.5">
      <Mark
        aria-hidden
        className={cn(
          'mt-0.5 size-4 shrink-0',
          isDone ? 'text-success' : 'text-muted-foreground',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'type-body',
            isDone &&
              'text-muted-foreground line-through decoration-foreground/30',
          )}
        >
          {title}
          {isDone && <span className="sr-only"> (done)</span>}
        </span>
        <span className="type-meta text-pretty text-muted-foreground">
          {detail}
        </span>
      </div>
      {!!action && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={action.run}
        >
          {action.label}
        </Button>
      )}
    </li>
  );
}

function RowGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="px-2 pb-1.5 type-caption text-subtle-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

function StarterRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left type-body text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}

/** The project's open threads on every computer, as the sidebar lists them, the latest started first. */
function useProjectThreads(projectKey: string | null): Thread[] {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const threads = useSpaceListing(spaceId);
  const { keyOf } = useThreadProjectKey(spaceId);
  if (!projectKey) return [];
  return threads
    .filter((t) => t.status !== 'settled' && keyOf(t) === projectKey)
    .toSorted((a, b) => b.startedAt - a.startedAt);
}

const STARTERS: {
  icon: IconComponent;
  label: string;
  prompt: string;
  needsDirty?: true;
}[] = [
  {
    icon: Eye,
    label: 'Review my uncommitted changes',
    prompt: 'Review my uncommitted changes',
    needsDirty: true,
  },
  {
    icon: Bug,
    label: 'Find and fix a bug',
    prompt: 'Find and fix the bug where ',
  },
  {
    icon: Pencil,
    label: 'Explain how this codebase fits together',
    prompt: 'Explain how this codebase fits together',
  },
];
