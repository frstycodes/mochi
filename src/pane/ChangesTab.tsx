import { Document } from 'reicon-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { summarize } from '../summary';
import type { PaneTabProps } from './tabs';

export function ChangesTab({ thread }: PaneTabProps) {
  const { files, added, removed } = summarize(thread.activity);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Select defaultValue="branch">
          <SelectTrigger size="sm" aria-label="Compare">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="branch">Branch</SelectItem>
              <SelectItem value="turn">Last turn</SelectItem>
              <SelectItem value="uncommitted">Uncommitted</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {!!thread.repo && (
          <Badge variant="secondary" className="min-w-0 font-mono">
            <span className="truncate">
              {thread.repo.branch} → origin/main
            </span>
          </Badge>
        )}
        <span className="flex-1" />
        <span className="tabular type-caption">
          <span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span>
        </span>
      </div>
      {files.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Document />
            </EmptyMedia>
            <EmptyTitle>No file changes yet</EmptyTitle>
            <EmptyDescription>Changes in this thread will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2 pb-2">
          {files.map((f) => (
            <Item key={f.path} asChild size="xs" className="gap-2.5 px-2 py-1.5 hover:bg-accent/60">
              <button type="button" onClick={() => toast('Diff view is not in the prototype yet')}>
                <ItemMedia>
                  <Document className="size-4 text-muted-foreground" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate font-mono text-xs font-normal">{f.path}</ItemTitle>
                </ItemContent>
                <ItemActions className="tabular type-caption">
                  <span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span>
                </ItemActions>
              </button>
            </Item>
          ))}
        </div>
        </ScrollArea>
      )}
    </div>
  );
}
