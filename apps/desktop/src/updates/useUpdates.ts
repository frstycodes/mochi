import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import type {
  ReleaseChannel,
  UpdateState,
} from '@mochi/domain/host/types/updates';

/** Mochi's own updater as main reports it, live; null until the first read. */
export function useUpdates() {
  const stateQuery = useQuery({
    queryKey: queryKeys.updates.state(),
    queryFn: () => host.updates.get(),
  });
  const state = stateQuery.data ?? null;
  useEffect(() => host.updates.onChange(store), []);
  const check = () =>
    host.updates.check().then(store, failed('check for updates'));
  const install = () =>
    host.updates.install().catch(failed('restart to update'));
  const setChannel = (channel: ReleaseChannel) =>
    host.updates
      .setChannel(channel)
      .then(store, failed('switch release channel'));
  return {
    state,
    summary: state && updateSummary(state),
    action: state && updateAction(state, { check, install }),
    setChannel,
  };
}

const store = (state: UpdateState) =>
  queryClient.setQueryData(queryKeys.updates.state(), state);

const failed = (what: string) => (error: Error) =>
  toast.error(`Couldn’t ${what}`, { description: error.message });

/** One line on where the updater stands, for the version row. */
function updateSummary(state: UpdateState) {
  switch (state.status) {
    case 'unsupported':
      return 'Updates need an installed build';
    case 'idle':
      return 'Not checked yet';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Up to date';
    case 'downloading':
      return `Downloading ${state.available ?? 'update'}${state.percent ? `, ${state.percent}%` : ''}…`;
    case 'ready':
      return `${state.available ?? 'Update'} ready to install`;
    case 'error':
      return `Update check failed: ${state.error ?? 'unknown error'}`;
  }
}

/** The one thing to do next: restart into a downloaded update, or check again; nothing while busy or unsupported. */
function updateAction(
  state: UpdateState,
  run: { check: () => Promise<unknown>; install: () => Promise<unknown> },
) {
  if (state.status === 'ready')
    return {
      kind: 'install',
      label: 'Restart to update',
      run: run.install,
    } as const;
  if (
    state.status === 'idle' ||
    state.status === 'up-to-date' ||
    state.status === 'error'
  )
    return {
      kind: 'check',
      label: 'Check for updates',
      run: run.check,
    } as const;
  return null;
}
