import { ScrollArea } from '@/components/ui/scroll-area';
import { VisualContent } from '../viz/FenceVisual';
import { VisualInPane } from '../viz/VisualFrame';
import { VizThreadProvider } from '../viz/WidgetVisual';
import type { PaneTabProps } from './tabs';

/** A chat visual opened in the side pane or popped out: the same fence, rendered at the pane's width. */
export function VisualTab({ thread, tab }: PaneTabProps) {
  if (!tab.visual) return null;
  return (
    <ScrollArea type="scroll" className="h-full">
      <div className="px-3 pb-3">
        <VizThreadProvider value={thread.id}>
          <VisualInPane>
            <VisualContent
              language={tab.visual.language}
              code={tab.visual.code}
              title={tab.title}
            />
          </VisualInPane>
        </VizThreadProvider>
      </div>
    </ScrollArea>
  );
}
