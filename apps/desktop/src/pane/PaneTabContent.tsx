import { useThreadOrigin } from '../remote/origin';
import { RemotePaneTab } from '../remote/RemotePanes';
import { PANE_TABS, type PaneTabProps } from './tabs';

/** A pane tab's body: its own component on this computer's thread; on another's, the one that reads from that computer. */
export function PaneTabContent(props: PaneTabProps) {
  const isRemote = useThreadOrigin().kind === 'remote';
  if (isRemote) return <RemotePaneTab {...props} />;
  const Content = PANE_TABS[props.tab.kind].component;
  return <Content {...props} />;
}
