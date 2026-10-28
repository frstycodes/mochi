import { useRemoteMachine } from '../remote/origin';
import { remotePaneReason } from '../remote/panes';
import { PlannedTab } from './PlannedTab';
import { PANE_TABS, type PaneTabProps } from './tabs';

/** A pane tab's body, the same on any thread; on another computer's, one that can't run there says why instead. */
export function PaneTabContent(props: PaneTabProps) {
  const machine = useRemoteMachine();
  const { title, icon, component: Content } = PANE_TABS[props.tab.kind];
  const reason =
    machine && remotePaneReason(props.tab.kind, machine, props.thread);
  if (reason)
    return (
      <PlannedTab
        icon={icon}
        title={`${title} isn’t here yet`}
        description={reason}
      />
    );
  return <Content {...props} />;
}
