import type { ReactNode } from 'react';
import { Bug, Eye, Pencil } from '@/icons';
import type { IconComponent } from '@/icons';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { Thread } from './model';
import { projectRef } from './projectRef';
import { ThreadItem } from './Sidebar';
import { useSpaceThreads } from './store';
import { useOpenThread } from './goals/SubThreads';

export function heroTitle(projectName: string | null) {
  return projectName
    ? `What should we build on ${projectName}?`
    : 'What should we build?';
}

export function HeroRows({
  project,
  isDirty,
  onStarter,
}: {
  project: string | null;
  isDirty: boolean;
  onStarter: (prompt: string) => void;
}) {
  const threads = useProjectThreads(project).slice(0, 3);
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

function useProjectThreads(project: string | null): Thread[] {
  const threads = useSpaceThreads();
  if (!project) return [];
  return threads
    .filter((t) => t.status !== 'settled' && projectRef(t.repo) === project)
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
