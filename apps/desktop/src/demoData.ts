import { host } from './host/index.ts';
import { getPrefs } from './settings/prefs.ts';

/** The fixture threads, queue, panes and profiles: always in the web build and the artifact; on desktop only when Settings › Data and storage turns them on. Read at startup. */
export function showsDemoData() {
  // GAP: dev-only. `?fresh` in the web build starts with no threads or projects, to see first run.
  if (
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('fresh')
  )
    return false;
  return !host.hasCore || getPrefs().demoData;
}
