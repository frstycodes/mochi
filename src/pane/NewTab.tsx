import { BranchUp } from 'reicon-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PANE_TAB_KINDS } from '../model';
import { useHarness } from '../store';
import { PANE_TABS, type PaneTabProps } from './tabs';

// A visual tab opens from its chat visual, never empty from here.
const OPENABLE = PANE_TAB_KINDS.filter((k) => k !== 'new' && k !== 'visual');

export function NewTab({ thread }: PaneTabProps) {
  const { dispatch } = useHarness();
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4">
        <section className="flex flex-col gap-2">
          <h3 className="type-caption text-subtle-foreground">Open</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {OPENABLE.map((kind) => {
              const { title, icon: Icon } = PANE_TABS[kind];
              return (
                <Item key={kind} asChild variant="muted" size="sm" className="rounded-xl">
                  <button type="button" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind })}>
                    <ItemMedia>
                      <Icon className="size-4" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="font-normal">{title}</ItemTitle>
                    </ItemContent>
                  </button>
                </Item>
              );
            })}
          </div>
        </section>
        {thread.prs.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="type-caption text-subtle-foreground">Recents</h3>
            {thread.prs.map((pr) => (
              <Item key={pr.number} size="sm" className="px-2">
                <ItemMedia>
                  <BranchUp className="size-4 text-muted-foreground" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-normal">{pr.title}</ItemTitle>
                  <ItemDescription>
                    #{pr.number} · {pr.state}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
