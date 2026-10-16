import { host } from './host/index.ts';
import { getPrefs } from './settings/prefs.ts';

/** The fixture threads, queue, panes and profiles: always in the web build and the artifact; on desktop only when Settings › Data and storage turns them on. Read at startup. */
export function showsDemoData() {
  return !host.isDesktop || getPrefs().demoData;
}
