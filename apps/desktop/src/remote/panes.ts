import type { FollowedMachine } from '../host/types/remote.ts';
import type { PaneTabKind, Thread } from '../model.ts';
import { elsewhereReason, missingScopeReason } from './origin.tsx';

/**
 * Panes another computer's thread opens in the app's own side pane, each reading from and acting on that computer through
 * commands, and the scope each needs. The others (preview, simulator, ports, PR, artifacts' files) would act on this computer.
 */
const REMOTE_PANES = {
  changes: { scope: 'code', needsFolder: true },
  files: { scope: 'code', needsFolder: true },
  terminal: { scope: 'terminal', needsFolder: true },
  sidechat: { scope: 'read', needsFolder: false },
  agents: { scope: 'read', needsFolder: false },
  visual: { scope: 'read', needsFolder: false },
} as const satisfies Partial<
  Record<
    PaneTabKind,
    { scope: FollowedMachine['scopes'][number]; needsFolder: boolean }
  >
>;

/** Why a pane can't open on another computer's thread: not one that runs there, a scope it wasn't given, no folder. */
export function remotePaneReason(
  kind: PaneTabKind,
  machine: Pick<FollowedMachine, 'name' | 'scopes'>,
  thread: Pick<Thread, 'repo' | 'live'>,
) {
  if (!(kind in REMOTE_PANES)) return elsewhereReason(machine);
  const { scope, needsFolder } =
    REMOTE_PANES[kind as keyof typeof REMOTE_PANES];
  const missing = missingScopeReason(machine, scope);
  if (missing) return missing;
  if (needsFolder && !thread.repo && !thread.live?.cwd)
    return 'This thread has no folder yet';
  return undefined;
}
