import { BrowserView } from '../Browser';
import type { PaneTabProps } from './tabs';

export function BrowserTab({ thread, pane, tab }: PaneTabProps) {
  return <BrowserView thread={thread} tab={tab} isDriving={pane.driver === thread.providers[0] && thread.status === 'running'} />;
}
