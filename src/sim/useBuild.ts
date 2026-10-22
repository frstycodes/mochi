import { useSyncExternalStore } from 'react';
import { toast } from '@/toast/store';
import { host } from '@/host';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { nextTabId } from '../store/panes';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { message } from './useSimulators';

export type BuildResult = { isOk: true; bundleId: string } | { isOk: false; error: string };

export interface BuildState {
  isBuilding: boolean;
  lastLine?: string;
  result?: BuildResult;
  /** Where the full log streams: a Terminal tab of the thread and its Build session. */
  log: { threadId: string; tabId: string; sessionId: string };
}

// Module-level, by device: a build keeps streaming and keeps its state while the Simulator tab is unmounted (Show log switches tabs).
const builds = new Map<string, BuildState>();
const listeners = new Set<() => void>();

/** Build & run for one device: the full log streams into a read-only Build session in a Terminal tab; this returns the compact status. */
export function useBuild(udid: string | null, thread: Thread) {
  const { state, dispatch } = useHarness();
  const openers = usePaneOpeners(thread.id);
  const build = useSyncExternalStore(subscribe, () => (udid ? builds.get(udid) : undefined));

  const run = async (cwd: string) => {
    if (!udid || build?.isBuilding) return;
    const { startBuildLog } = await import('../terminal/sessions');
    if (builds.get(udid)?.isBuilding) return;
    const pane = state.panes.find((p) => p.threadId === thread.id);
    const terminal = pane?.tabs.find((t) => t.kind === 'terminal');
    const tabId = terminal?.id ?? nextTabId(pane?.tabs ?? []);
    if (!terminal) dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'terminal', isBackground: true });
    const session = startBuildLog(`${thread.id}/${tabId}`, { cwd, threadId: thread.id, links: openers });
    const log = { threadId: thread.id, tabId, sessionId: session.id };
    set(udid, { isBuilding: true, log });
    const off = host.sim.onBuildLog((line) => {
      if (line.udid !== udid) return;
      session.term.write(`${line.text}\r\n`);
      set(udid, { ...builds.get(udid)!, lastLine: line.text });
    });
    try {
      const { bundleId } = await host.sim.buildAndRun(udid, cwd);
      set(udid, { ...builds.get(udid)!, isBuilding: false, result: { isOk: true, bundleId } });
      toast.success(`Launched ${bundleId}`);
    } catch (e) {
      session.term.write(`\x1b[31m${message(e)}\x1b[0m\r\n`);
      set(udid, { ...builds.get(udid)!, isBuilding: false, result: { isOk: false, error: message(e) } });
      toast.error('Build failed', { description: message(e) });
    } finally {
      off();
    }
  };

  const showLog = () => {
    if (!build) return;
    const { threadId, tabId, sessionId } = build.log;
    if (!state.panes.find((p) => p.threadId === threadId)?.isOpen) dispatch({ type: 'pane-toggle', threadId });
    dispatch({ type: 'pane-select-tab', threadId, tabId });
    void import('../terminal/sessions').then(({ showSession }) => showSession(`${threadId}/${tabId}`, sessionId));
  };

  const dismiss = () => {
    if (!udid || build?.isBuilding) return;
    builds.delete(udid);
    listeners.forEach((l) => l());
  };

  return { build, run, showLog, dismiss };
}

function set(udid: string, next: BuildState) {
  builds.set(udid, next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
