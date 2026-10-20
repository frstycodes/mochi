import { Fragment, useState, type ReactNode } from 'react';
import { ChevronDown } from '@/icons';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import type { LibraryEntry } from './library';
import { countOf, LibraryIcon } from './LibraryParts';

/**
 * Installed skills with the ones from one GitHub repo folded into a group (`emilkowalski/skills · 15 skills`), so a repo
 * added whole doesn't bury the rest. `row` draws one skill; `control` sits on a group's header and acts on all of it.
 */
export function SkillGroups({ entries, row, control }: { entries: LibraryEntry[]; row: (entry: LibraryEntry) => ReactNode; control: (group: SkillGroup) => ReactNode }) {
  const groups = groupByRepo(entries);
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (repo: string) => setOpen((was) => (was.includes(repo) ? was.filter((r) => r !== repo) : [...was, repo]));
  return (
    <Accordion type="multiple" value={open} onValueChange={setOpen}>
      {groups.map((group) =>
        group.entries.length === 1 ? <Fragment key={group.entries[0].id}>{row(group.entries[0])}</Fragment> : <GroupRow key={group.repo} group={group} isOpen={open.includes(group.repo)} onToggle={() => toggle(group.repo)} row={row} control={control} />,
      )}
    </Accordion>
  );
}

export interface SkillGroup {
  repo: string;
  entries: LibraryEntry[];
}

/** The chevron sits where a skill row's ⋯ does, so the group's control lines up with its skills' controls. */
function GroupRow({ group, isOpen, onToggle, row, control }: { group: SkillGroup; isOpen: boolean; onToggle: () => void; row: (entry: LibraryEntry) => ReactNode; control: (group: SkillGroup) => ReactNode }) {
  const [first] = group.entries;
  return (
    <AccordionItem value={group.repo} className="relative not-last:border-b-0 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      {/* The primitive wraps the trigger in an unstyled flex Header; it takes the row so the controls sit at the right edge. */}
      <div className="flex items-center gap-2 pr-4 *:first:min-w-0 *:first:flex-1">
        <AccordionTrigger className="min-w-0 items-center gap-3 rounded-none py-3 pl-4 font-normal hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden">
          <LibraryIcon key={first.icon} url={first.icon} letter={group.repo} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate type-body font-medium">{group.repo}</span>
            <span className="truncate type-caption text-subtle-foreground">{countOf(group.entries.length, 'skill')}</span>
          </span>
        </AccordionTrigger>
        <div className="flex shrink-0 items-center gap-2">
          {control(group)}
          {/* Pointer-only twin of the trigger, which already holds the focus and the expanded state. */}
          <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-hidden onClick={onToggle}>
            <ChevronDown className={cn('transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none', isOpen && 'rotate-180')} />
          </Button>
        </div>
      </div>
      <AccordionContent className="bg-muted/30 p-0">
        {group.entries.map((entry) => (
          <Fragment key={entry.id}>{row(entry)}</Fragment>
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}

/** Groups in the order their first skill appears; a skill with no GitHub source is a group of its own. */
export function groupByRepo(entries: LibraryEntry[]): SkillGroup[] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    const key = repoOf(entry.source) ?? `entry:${entry.id}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([repo, list]) => ({ repo, entries: list }));
}

// A GitHub skill's source is `owner/repo/<dir>` with an optional `#ref`; an imported one's is a path, never grouped.
const repoOf = (source: string | null) => source?.match(/^([\w.-]+\/[\w.-]+)(?:[/#]|$)/)?.[1] ?? null;
