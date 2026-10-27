import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Thread } from './model';
import {
  commandOf,
  isCommand,
  isHeld,
  listenKeydown,
  type CommandId,
} from './keymap';
import { filteredSidebarLists, useProjectFilter } from './projectFilter';
import { flattenGroups } from './reorder';
import {
  useDispatch,
  useHarnessSelector,
  useSpaceListing,
  useView,
} from './store';
import {
  ThreadDetailText,
  ThreadProjectMark,
  rowStatusMark,
  useThreadRow,
} from './threadRow';
import { stepThread } from './threadSwitch';
import { StatusMark } from './ui';

/** A quick tap switches without the panel flashing up, like Windows' Alt Tab. */
const SHOW_DELAY = 120;

const STEPS = ['thread-next', 'thread-previous'] as const;

/**
 * Next / previous thread in the sidebar's order, held like Windows' Alt Tab: while the chord's modifier stays down, the panel
 * shows the threads and Tab steps the pick; letting go opens it, Esc keeps the thread you're on.
 */
export function ThreadSwitcher() {
  const dispatch = useDispatch();
  const threads = useSwitcherThreads();
  const view = useView();
  const currentId = view.kind === 'thread' ? view.id : undefined;
  const [pick, setPick] = useState<{ id: string; isShown: boolean } | null>(
    null,
  );

  const commit = (id: string) => {
    setPick(null);
    if (id && id !== currentId)
      dispatch({ type: 'go', view: { kind: 'thread', id } });
  };

  const choose = useSwitcherKeys({
    ids: threads.map((t) => t.id),
    currentId,
    open: (id) => setPick({ id, isShown: false }),
    show: () => setPick((p) => p && { ...p, isShown: true }),
    step: (id) => setPick((p) => p && { ...p, id }),
    commit,
    cancel: () => setPick(null),
  });

  if (!pick?.isShown) return null;
  return (
    <SwitcherPanel
      threads={threads}
      pickedId={pick.id}
      currentId={currentId}
      onPick={choose}
    />
  );
}

/** The space's open threads in the sidebar's order, narrowed by its project filter: pinned, then the rest, sub-threads under theirs. */
function useSwitcherThreads() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const threads = useSpaceListing(spaceId);
  const filter = useProjectFilter(spaceId, threads).selected;
  const { pinned, active } = filteredSidebarLists(threads, spaceId, filter);
  return flattenGroups([...pinned, ...active]);
}

/** The glass panel over the app: one row per thread like the sidebar's, the pick filled; a click picks one. */
function SwitcherPanel({
  threads,
  pickedId,
  currentId,
  onPick,
}: {
  threads: Thread[];
  pickedId: string;
  currentId: string | undefined;
  onPick: (id: string) => void;
}) {
  const picked = threads.find((t) => t.id === pickedId);
  return (
    <div className="pointer-events-none fixed inset-0 z-[400] flex items-center justify-center p-8">
      <div
        role="listbox"
        aria-label="Switch thread"
        aria-activedescendant={`switch-${pickedId}`}
        className="pointer-events-auto flex max-h-[70vh] w-[30rem] flex-col gap-1 overflow-y-auto rounded-3xl border surface-glass p-3 shadow-overlay"
      >
        {threads.map((t) => (
          <SwitcherRow
            key={t.id}
            thread={t}
            isPicked={t.id === pickedId}
            isCurrent={t.id === currentId}
            onPick={() => onPick(t.id)}
          />
        ))}
      </div>
      <div aria-live="polite" className="sr-only">
        {picked?.title}
      </div>
    </div>
  );
}

// The pick is a fill, never a ring: a box-shadow ring doesn't follow the global squircle corner and smears at the corners.
function SwitcherRow({
  thread,
  isPicked,
  isCurrent,
  onPick,
}: {
  thread: Thread;
  isPicked: boolean;
  isCurrent: boolean;
  onPick: () => void;
}) {
  const row = useThreadRow(thread);
  const mark = rowStatusMark(row, isCurrent);
  return (
    <div
      id={`switch-${thread.id}`}
      role="option"
      aria-selected={isPicked}
      aria-current={isCurrent || undefined}
      ref={(el) => {
        if (isPicked) el?.scrollIntoView({ block: 'nearest' });
      }}
      onClick={onPick}
      className={cn(
        'flex shrink-0 cursor-default items-center gap-3 rounded-md px-3 py-2 text-sidebar-foreground/75',
        isPicked
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      <ThreadProjectMark thread={thread} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{thread.title}</span>
        <span className="flex min-w-0 type-caption text-subtle-foreground">
          <ThreadDetailText row={row} />
        </span>
      </span>
      {mark && <StatusMark {...mark} />}
    </div>
  );
}

/**
 * The chord picks the thread after the one you're on (or the one already picked) and, while its modifier is held, opens the
 * panel; a chord without one switches at once. Keys go to the panel while it's open, before anything else hears them.
 * Returns how a click picks a thread, ending the hold so letting go doesn't switch again.
 */
function useSwitcherKeys(handlers: {
  ids: string[];
  currentId: string | undefined;
  open: (id: string) => void;
  show: () => void;
  step: (id: string) => void;
  commit: (id: string) => void;
  cancel: () => void;
}) {
  const read = useEffectEvent(() => handlers);
  // Not React state: a quick tap's keyup can land before the keydown's render.
  const held = useRef<{ by: CommandId; id: string } | null>(null);
  const commit = (id: string) => {
    held.current = null;
    handlers.commit(id);
  };

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      clearTimeout(showTimer);
      held.current = null;
    };
    const commitHeld = () => {
      const id = held.current!.id;
      close();
      read().commit(id);
    };
    const stepFrom = (fromId: string | undefined, command: CommandId) =>
      stepThread(read().ids, fromId, command === 'thread-previous' ? -1 : 1);

    const onKeyDown = (e: KeyboardEvent) => {
      if (held.current) return;
      const command = commandOf(e, STEPS);
      if (!command) return;
      const { currentId } = read();
      const id = stepFrom(currentId, command);
      if (!id || id === currentId) return;
      e.preventDefault();
      if (!isHeld(e, command)) return read().commit(id);
      held.current = { by: command, id };
      read().open(id);
      showTimer = setTimeout(() => read().show(), SHOW_DELAY);
    };
    const onCaptureKeyDown = (e: KeyboardEvent) => {
      if (!held.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const command =
        commandOf(e, STEPS) ??
        (e.key === 'ArrowRight' ? 'thread-next' : undefined) ??
        (e.key === 'ArrowLeft' ? 'thread-previous' : undefined);
      if (command) {
        const id = stepFrom(held.current.id, command);
        if (!id) return;
        held.current.id = id;
        read().step(id);
      } else if (isCommand(e, 'dismiss')) {
        close();
        read().cancel();
      } else if (e.key === 'Enter') commitHeld();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (held.current && !isHeld(e, held.current.by)) commitHeld();
    };
    const onBlur = () => {
      if (!held.current) return;
      close();
      read().cancel();
    };

    const stopCapture = listenKeydown(onCaptureKeyDown, true);
    const stopKeyDown = listenKeydown(onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(showTimer);
      stopCapture();
      stopKeyDown();
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return commit;
}
