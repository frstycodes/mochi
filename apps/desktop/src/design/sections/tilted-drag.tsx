import {
  Fragment,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { motion } from 'motion/react';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { Thread } from '../../model';
import { dropAt, type DropSlot } from '../../reorder';
import { DragGhost } from '../../DragGhost';
import { DropLine } from '../../DropLine';
import { ThreadItem } from '../../Sidebar';
import { Block } from '../layout';
import { verdictFixtures } from '../verdictFixtures';

/** Sidebar rows on the real drop rules (`dropAt`): the tilted ghost and the drop line. Mock data; nothing is saved. */
export function TiltedDragBlock({ rl }: { rl: Thread }) {
  const threads = verdictFixtures(rl)
    .slice(0, TITLES.length)
    .map((f, i) => ({ ...f.thread, id: `tilted-${i}`, title: TITLES[i] }));
  return (
    <Block
      title="Dragging rows"
      use="Pick a row up: it hangs from where you grabbed it (held left, its right end dips; held right, its left end; up to 4°) and levels out as it lands. A line marks where it drops. A sub-thread stays under its parent: a drag never nests or un-nests, the row menu moves it out."
      wide
    >
      <DragList threads={threads} />
    </Block>
  );
}

const TITLES = [
  'Public API rate limiting',
  'Onboarding checklist copy',
  'Flaky e2e on CI',
  'Dark mode chart colors',
  'Migrate auth to sessions',
  'Weekly digest email',
];

interface Row {
  id: string;
  parentId?: string;
}

interface Drag {
  id: string;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  slot: DropSlot | null;
}

function DragList({ threads }: { threads: Thread[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    threads.map((t, i) =>
      i === 1 ? { id: t.id, parentId: threads[0].id } : { id: t.id },
    ),
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const byId = new Map(threads.map((t) => [t.id, t]));

  const onPointerDown = (e: ReactPointerEvent<HTMLLIElement>, row: Row) => {
    if (e.button !== 0 || row.parentId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let current: Drag | null = null;
    const onMove = (ev: PointerEvent) => {
      if (
        !current &&
        Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD
      )
        return;
      const slot = slotFor(listRef.current, row, ev.clientY);
      current = {
        id: row.id,
        x: ev.clientX - (start.x - rect.left),
        y: ev.clientY - (start.y - rect.top),
        grabX: start.x - rect.left,
        grabY: start.y - rect.top,
        width: rect.width,
        height: rect.height,
        slot,
      };
      setDrag(current);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (current?.slot) setRows((all) => dropRow(all, row.id, current!.slot!));
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const tops = rows.filter((r) => !r.parentId && r.id !== drag?.id);
  const item = (row: Row) => (
    <SidebarMenuItem
      key={row.id}
      asChild
      data-row-id={row.id}
      data-sub-of={row.parentId}
      onPointerDown={(e: ReactPointerEvent<HTMLLIElement>) =>
        onPointerDown(e, row)
      }
      className={cn('select-none', row.parentId && 'pl-[27px]')}
    >
      <motion.li
        layout="position"
        layoutId={`tilted-row-${row.id}`}
        transition={SLIDE}
      >
        <ThreadItem
          thread={byId.get(row.id)!}
          isSub={!!row.parentId}
          isActive={false}
          onSelect={() => undefined}
        />
      </motion.li>
    </SidebarMenuItem>
  );
  const items = tops.map((top) => (
    <Fragment key={top.id}>
      {item(top)}
      {rows.filter((r) => r.parentId === top.id && r.id !== drag?.id).map(item)}
    </Fragment>
  ));
  const slot = drag?.slot;
  if (slot)
    items.splice(
      slot.index,
      0,
      <DropLine
        key="line"
        height={drag.height}
        glide={{ layout: 'position', transition: SLIDE }}
      />,
    );

  const dragged = drag && byId.get(drag.id);
  return (
    <div className="w-[256px] overflow-hidden rounded-xl border bg-sidebar p-2">
      <SidebarProvider className="min-h-0">
        <SidebarMenu ref={listRef} className="relative">
          {items}
        </SidebarMenu>
        {!!drag && !!dragged && (
          <DragGhost
            x={drag.x}
            y={drag.y}
            width={drag.width}
            grabX={drag.grabX}
            grabY={drag.grabY}
            layoutId={`tilted-row-${drag.id}`}
            className="rounded-md bg-sidebar text-sidebar-foreground"
          >
            <ul data-sidebar="menu" className="list-none">
              <SidebarMenuItem>
                <ThreadItem
                  thread={dragged}
                  isActive={false}
                  onSelect={() => undefined}
                />
              </SidebarMenuItem>
            </ul>
          </DragGhost>
        )}
      </SidebarProvider>
    </div>
  );
}

/** The real sidebar rule on the mock's rows, one section (no Pinned). */
function slotFor(list: HTMLUListElement | null, row: Row, y: number) {
  if (!list) return null;
  const boxes = [...list.querySelectorAll<HTMLElement>('[data-row-id]')].map(
    (el) => ({
      id: el.dataset.rowId!,
      top: el.offsetTop,
      height: el.offsetHeight,
      isPinned: false,
      ...(el.dataset.subOf && { parentId: el.dataset.subOf }),
    }),
  );
  return dropAt(boxes, -1, row.id, y - list.getBoundingClientRect().top, false);
}

function dropRow(rows: Row[], id: string, slot: DropSlot) {
  const rest = rows.filter((r) => r.id !== id);
  const tops = rest.filter((r) => !r.parentId);
  const before = tops[slot.index];
  const i = before ? rest.indexOf(before) : rest.length;
  return [...rest.slice(0, i), { id }, ...rest.slice(i)];
}

const DRAG_THRESHOLD = 5;
const SLIDE = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;
