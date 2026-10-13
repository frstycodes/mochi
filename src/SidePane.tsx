import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Reorder } from 'motion/react';
import { Add, Pip, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { revealIn } from '@/lib/revealIn';
import { cn } from '@/lib/utils';
import type { Pane, PaneTab, Thread } from './model';
import { PANE_TABS, tabTitle } from './pane/tabs';
import { isOverPinDrop, setPinned } from './pane/headerPins';
import { endDrag, moveDrag, startDrag } from './layout/drag';
import { useHarness } from './store';
import { isMod } from './keys';
import { TAB_MENU } from './menus/menus';
import { TargetContextMenu } from './menus/TargetContextMenu';

export function SidePane({ thread, pane }: { thread: Thread; pane: Pane }) {
  const docked = pane.tabs.filter((t) => !t.isPopped);
  const active = docked.find((t) => t.id === pane.activeTab) ?? docked[0];
  const onKeyDown = usePaneKeys(thread.id, docked, active);

  return (
    <section aria-label="Side pane" tabIndex={-1} onKeyDown={onKeyDown} className="flex h-full min-w-0 flex-col border-l border-sidebar-border bg-sidebar outline-none">
      <TabStrip thread={thread} tabs={docked} active={active} />
      <div className="min-h-0 flex-1">{active ? <ActiveTab thread={thread} pane={pane} tab={active} /> : <PoppedOut thread={thread} pane={pane} />}</div>
    </section>
  );
}

/** mod 1–9 (9 is the last tab), Ctrl Tab / Ctrl Shift Tab and mod W while focus is inside the pane. mod, not Ctrl, for digits: nav 1–3 switches spaces. */
function usePaneKeys(threadId: string, tabs: PaneTab[], active?: PaneTab) {
  const { dispatch } = useHarness();
  return (e: KeyboardEvent) => {
    const index = active ? tabs.indexOf(active) : -1;
    const select = (tab?: PaneTab) => tab && dispatch({ type: 'pane-select-tab', threadId, tabId: tab.id });
    if (e.ctrlKey && e.key === 'Tab') select(tabs.at((index + (e.shiftKey ? -1 : 1)) % tabs.length));
    else if (isMod(e) && /^[1-9]$/.test(e.key)) select(e.key === '9' ? tabs.at(-1) : tabs[Number(e.key) - 1]);
    else if (isMod(e) && e.key.toLowerCase() === 'w' && active) dispatch({ type: 'pane-close-tab', threadId, tabId: active.id });
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
}

function ActiveTab({ thread, pane, tab }: { thread: Thread; pane: Pane; tab: PaneTab }) {
  const Content = PANE_TABS[tab.kind].component;
  return <Content thread={thread} pane={pane} tab={tab} />;
}

function TabStrip({ thread, tabs, active }: { thread: Thread; tabs: PaneTab[]; active?: PaneTab }) {
  const { dispatch } = useHarness();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector('[aria-selected=true]');
    if (list && tab) revealIn(list, tab);
  }, [active?.id]);
  const order = tabs.map((t) => t.id);
  const reorder = (next: string[]) => dispatch({ type: 'pane-reorder', threadId: thread.id, order: next });
  const move = (id: string, step: 1 | -1) => {
    const from = order.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    reorder(next);
  };
  const canPop = !!active && active.kind !== 'new';

  return (
    <div className="app-drag flex h-11 shrink-0 items-center gap-1 px-2">
      <Reorder.Group ref={listRef} as="div" axis="x" values={order} onReorder={reorder} role="tablist" aria-label="Side pane tabs" className="flex min-w-0 items-center gap-1 overflow-x-auto select-none" style={{ scrollbarWidth: 'none' }}>
        {tabs.map((tab) => {
          const Icon = PANE_TABS[tab.kind].icon;
          const title = tabTitle(tab);
          const isActive = tab.id === active?.id;
          return (
            <TargetContextMenu key={tab.id} target={{ threadId: thread.id, tabId: tab.id }} groups={TAB_MENU}>
              <Reorder.Item
                as="div"
                value={tab.id}
                onDragStart={(_, info) => {
                  setDraggingId(tab.id);
                  startDrag({ kind: 'tab', threadId: thread.id, tabId: tab.id }, title, info.point.x, info.point.y);
                }}
                onDrag={(_, info) => moveDrag(info.point.x, info.point.y)}
                onDragEnd={(_, info) => {
                  setDraggingId(null);
                  const landed = endDrag();
                  if (isOverPinDrop(info.point.x, info.point.y)) return setPinned(tab.kind, true);
                  if (landed) dispatch({ type: 'layout-drop', ...landed });
                }}
                className={cn(
                  'group/tab relative flex h-7 min-w-16 flex-[0_1_11rem] items-center rounded-lg',
                  isActive ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:bg-accent/60',
                  draggingId === tab.id && 'z-10 bg-background shadow-float',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  onClick={() => dispatch({ type: 'pane-select-tab', threadId: thread.id, tabId: tab.id })}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                    e.preventDefault();
                    move(tab.id, e.key === 'ArrowLeft' ? -1 : 1);
                  }}
                  className="flex h-full min-w-0 cursor-default items-center gap-1.5 pr-1 pl-2.5 type-meta"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{title}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Close ${title}`}
                  onClick={() => dispatch({ type: 'pane-close-tab', threadId: thread.id, tabId: tab.id })}
                  className={cn('mr-1 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100', isActive && 'opacity-100')}
                >
                  <X />
                </Button>
              </Reorder.Item>
            </TargetContextMenu>
          );
        })}
      </Reorder.Group>
      <Button variant="ghost" size="icon-sm" aria-label="New tab" className="shrink-0" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'new' })}>
        <Add />
      </Button>
      <span className="flex-1" />
      {canPop && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Pop ${tabTitle(active)} out`} className="shrink-0" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: active.id, isPopped: true })}>
              <Pip />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Pop out into a floating window</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function PoppedOut({ thread, pane }: { thread: Thread; pane: Pane }) {
  const { dispatch } = useHarness();
  const popped = pane.tabs.find((t) => t.isPopped);
  const Icon = popped ? PANE_TABS[popped.kind].icon : Add;
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{popped ? `${tabTitle(popped)} is floating` : 'No tabs open'}</EmptyTitle>
        <EmptyDescription>{popped ? 'It follows this thread around. Put it back here any time.' : 'Open a preview, the changes, a terminal or files.'}</EmptyDescription>
      </EmptyHeader>
      {popped ? (
        <Button size="sm" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: popped.id, isPopped: false })}>
          Put back in the pane
        </Button>
      ) : (
        <Button size="sm" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'new' })}>
          Open a tab
        </Button>
      )}
    </Empty>
  );
}
