import type { QueueItem, Thread } from '../model.ts';
import type {
  NotificationsAction,
  NotificationsState,
} from '../notify/slice.ts';
import type { ToolUndo } from '../runtime/undo.ts';
import type { ScheduleAction } from '../schedule/slice.ts';
import type { ReviewAction } from '../secondOpinion/slice.ts';
import type { LayoutAction, LayoutState } from './layout.ts';
import type { PanesAction, PanesState } from './panes.ts';
import type { QueueAction, QueueState } from './queue.ts';
import type { SideChatAction, SideChatState } from './sidechat.ts';
import type { ThreadsAction, ThreadsState } from './threads.ts';
import type { UiAction, UiState } from './ui.ts';

export interface Snapshot {
  threads: Thread[];
  queue: QueueItem[];
}

export type State = ThreadsState &
  QueueState &
  PanesState &
  LayoutState &
  UiState &
  SideChatState &
  NotificationsState;
export type Action =
  | ThreadsAction
  | QueueAction
  | PanesAction
  | LayoutAction
  | UiAction
  | SideChatAction
  | ReviewAction
  | NotificationsAction
  | ScheduleAction
  | { type: 'reset' }
  | { type: 'tool-undo'; undo: ToolUndo };
