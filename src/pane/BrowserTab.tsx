import { BrowserView, drivenTab } from '../Browser';
import type { PaneTabProps } from './tabs';

export function BrowserTab({ thread, pane, tab }: PaneTabProps) {
  return <BrowserView thread={thread} tab={tab} isDriving={drivenTab(thread, pane)?.id === tab.id} />;
}
