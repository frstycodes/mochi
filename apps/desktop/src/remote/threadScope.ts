import type { Action, State } from '../store';
import { REMOTE_SIDE_CHAT_TAB } from '../store/remoteSideChat.ts';
import type { SideChat } from '../store/sidechat.ts';

/** What another computer's thread brings from its mirror; every other slice is this window's own (panes, layouts, side chats). */
const MIRRORED_KEYS = [
  'threads',
  'seq',
  'checkpoints',
  'checkpointSeq',
  'rewindUndo',
  'forks',
  'queue',
] as const satisfies readonly (keyof State)[];

/** This window's state with the owning computer's threads in it: the store `RemoteThreadScope` hands the shared views. */
export function hybridState(local: LocalSlices, mirror: State): State {
  const mirrored = Object.fromEntries(MIRRORED_KEYS.map((k) => [k, mirror[k]]));
  return {
    ...local,
    ...(mirrored as Pick<State, MirroredKey>),
    sidechats: withRemoteSideChats(local, mirror),
  };
}

const NO_MESSAGES: SideChat['messages'] = [];

/**
 * Each side chat tab this window has on one of the mirror's threads, showing that thread's remote side chat (asked and
 * answered on its computer, `store/remoteSideChat.ts`); the tab's quote and a `/side` question waiting to go stay this
 * window's. Nothing to show leaves this window's side chats as they are.
 */
function withRemoteSideChats(local: LocalSlices, mirror: State) {
  const remote = new Set(mirror.threads.map((t) => t.id));
  const tabsOf = (threadId: string) =>
    new Set([
      ...(local.panes.find((p) => p.threadId === threadId)?.tabs ?? [])
        .filter((t) => t.kind === 'sidechat')
        .map((t) => t.id),
      ...Object.keys(local.sidechats[threadId] ?? {}),
    ]);
  const threadIds = new Set([
    ...local.panes.map((p) => p.threadId),
    ...Object.keys(local.sidechats),
  ]);
  const shown = [...threadIds].flatMap((threadId) => {
    const tabs = remote.has(threadId) ? tabsOf(threadId) : new Set<string>();
    if (!tabs.size) return [];
    const messages =
      mirror.sidechats[threadId]?.[REMOTE_SIDE_CHAT_TAB]?.messages ??
      NO_MESSAGES;
    const here = local.sidechats[threadId] ?? {};
    const byTab = Object.fromEntries(
      [...tabs].map((tabId) => {
        const { draft, pending } = here[tabId] ?? {};
        const chat: SideChat = {
          messages,
          ...(draft && { draft }),
          ...(pending && { pending }),
        };
        return [tabId, chat];
      }),
    );
    return [[threadId, byTab]];
  });
  return shown.length
    ? { ...local.sidechats, ...Object.fromEntries(shown) }
    : local.sidechats;
}

type MirroredKey = (typeof MIRRORED_KEYS)[number];
export type LocalSlices = Omit<State, MirroredKey>;

/** This window's slices only, for a selector that ignores this computer's own thread traffic. */
export function localSlices(state: State): LocalSlices {
  const local: Partial<State> = { ...state };
  for (const key of MIRRORED_KEYS) delete local[key];
  return local as LocalSlices;
}

const LOCAL_ACTIONS = new Set<Action['type']>([
  'go',
  'overview-toggle',
  'watch-toggle',
  'sidechat-open',
  'sidechat-draft',
  // Under a remote thread it only drops this window's quote and waiting question: the chat itself is its computer's.
  'sidechat-clear',
]);

/** Actions of this screen (splits, panes, what's watched) that stay here; none touches Core's projection (`DOMAIN_KEYS`). */
export const isScreenAction = (action: Action) =>
  action.type.startsWith('pane-') ||
  action.type.startsWith('layout-') ||
  LOCAL_ACTIONS.has(action.type);

/** Bookkeeping the shared views dispatch that has no meaning on the owning computer: dropped without a word. */
export const isQuietAction = (action: Action) =>
  action.type === 'next-move-record';
