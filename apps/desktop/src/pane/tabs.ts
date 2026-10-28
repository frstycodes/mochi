import type { ComponentType } from 'react';
import type { Pane, PaneTab, PaneTabKind, Thread } from '../model';
import { PANE_TAB_LABELS } from './tabLabels';
import { AgentsTab } from './AgentsTab';
import { ArtifactsTab } from './ArtifactsTab';
import { BrowserTab } from './BrowserTab';
import { ChangesTab } from './ChangesTab';
import { FilesTab } from './FilesTab';
import { PortsTab } from './PortsTab';
import { PrTab } from './PrTab';
import { SideChatTab } from './SideChatTab';
import { SimulatorTab } from './SimulatorTab';
import { TerminalTab } from './TerminalTab';
import { VisualTab } from './VisualTab';

export interface PaneTabProps {
  thread: Thread;
  pane: Pane;
  tab: PaneTab;
}

const COMPONENTS = {
  browser: BrowserTab,
  changes: ChangesTab,
  terminal: TerminalTab,
  files: FilesTab,
  simulator: SimulatorTab,
  ports: PortsTab,
  sidechat: SideChatTab,
  agents: AgentsTab,
  visual: VisualTab,
  artifacts: ArtifactsTab,
  pr: PrTab,
} satisfies Record<PaneTabKind, ComponentType<PaneTabProps>>;

export const PANE_TABS = Object.fromEntries(
  Object.entries(PANE_TAB_LABELS).map(([kind, label]) => [
    kind,
    { ...label, component: COMPONENTS[kind as PaneTabKind] },
  ]),
) as {
  [K in PaneTabKind]: (typeof PANE_TAB_LABELS)[K] & {
    component: ComponentType<PaneTabProps>;
  };
};

export function tabTitle(tab: PaneTab) {
  return tab.title ?? PANE_TAB_LABELS[tab.kind].title;
}
