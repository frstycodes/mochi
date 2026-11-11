import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { revealMessage } from '../chat/Transcript';
import {
  PaneSection,
  PaneSectionHeader,
  PaneSectionTitle,
} from '../pane/PaneList';
import type { PaneTabProps } from '../pane/tabs';
import { LOGBOOK_KINDS, LOGBOOK_LABELS, LogbookRows } from './LogbookRows';
import { removeAnswer } from './marks';
import { useThreadLogbook } from './useLogbook';

/** What this thread is worth coming back for: answers, the decisions and assumptions its turns reported, and suggested work that never started. */
export function LogbookTab({ thread }: PaneTabProps) {
  const { now, ...log } = useThreadLogbook(thread);
  const kinds = LOGBOOK_KINDS.filter((kind) => log[kind].length > 0);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-3">
        {kinds.length === 0 && <NoLogbook />}
        {kinds.map((kind) => (
          <PaneSection key={kind}>
            <PaneSectionHeader>
              <PaneSectionTitle count={log[kind].length}>
                {LOGBOOK_LABELS[kind]}
              </PaneSectionTitle>
            </PaneSectionHeader>
            <LogbookRows
              kind={kind}
              log={log}
              now={now}
              onOpen={(index, about) => revealMessage(thread.id, index, about)}
              onRemove={(answer) => removeAnswer(thread.id, answer)}
            />
          </PaneSection>
        ))}
      </div>
    </ScrollArea>
  );
}

function NoLogbook() {
  return (
    <Empty className="rounded-lg bg-muted/40 p-5">
      <EmptyHeader>
        <EmptyTitle>Nothing logged yet</EmptyTitle>
        <EmptyDescription>
          Answers to your questions, the decisions the agent reports and work it
          suggested for later collect here. Save any reply from its actions.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
