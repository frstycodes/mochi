/** Which registry actions each context menu offers, grouped by separator. Ids that aren't available on the target drop out. */
export const THREAD_MENU = [
  ['thread-open', 'thread-open-split'],
  ['thread-pin', 'thread-unpin', 'thread-watch', 'thread-unwatch'],
  ['thread-schedule', 'thread-fork', 'thread-handoff', 'thread-second-opinion', 'thread-rewind'],
  ['thread-replay', 'thread-export-replay'],
  ['thread-copy-branch', 'thread-reveal'],
  ['thread-settle', 'thread-reactivate'],
] as const;

export const TAB_MENU = [
  ['tab-reload', 'tab-duplicate'],
  ['tab-pop', 'tab-split'],
  ['tab-close', 'tab-close-others', 'tab-close-right'],
] as const;

export const SPLIT_MENU = [
  ['layout-split', 'layout-split-down'],
  ['layout-zoom', 'layout-unzoom', 'layout-swap', 'layout-rotate'],
  ['layout-close'],
] as const;

/** The open thread's own actions, without Open: its header ⋯ menu. */
export const THREAD_ACTIONS_MENU = THREAD_MENU.slice(1);

/** A thread split's header: the thread first (it is already open), then the split. */
export const THREAD_HEADER_MENU = [...THREAD_ACTIONS_MENU, ...SPLIT_MENU];
