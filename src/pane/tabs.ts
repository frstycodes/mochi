import type { ComponentType } from 'react';
import { Chart, Folder, Layers, Globe, Hierarchy, MessagePlus, Phone, Plug, type IconComponent } from '@/icons';
import type { Pane, PaneTab, PaneTabKind, Thread } from '../model';
import { DiffIcon, TerminalIcon } from '../icons/panes';
import { AgentsTab } from './AgentsTab';
import { ArtifactsTab } from './ArtifactsTab';
import { BrowserTab } from './BrowserTab';
import { ChangesTab } from './ChangesTab';
import { FilesTab } from './FilesTab';
import { PortsTab } from './PortsTab';
import { SideChatTab } from './SideChatTab';
import { SimulatorTab } from './SimulatorTab';
import { TerminalTab } from './TerminalTab';
import { VisualTab } from './VisualTab';

export interface PaneTabProps {
  thread: Thread;
  pane: Pane;
  tab: PaneTab;
}

export const PANE_TABS = {
  browser: { title: 'Preview', icon: Globe, component: BrowserTab },
  changes: { title: 'Changes', icon: DiffIcon, component: ChangesTab },
  terminal: { title: 'Terminal', icon: TerminalIcon, component: TerminalTab },
  files: { title: 'Files', icon: Folder, component: FilesTab },
  simulator: { title: 'Simulator', icon: Phone, component: SimulatorTab },
  ports: { title: 'Ports', icon: Plug, component: PortsTab },
  sidechat: { title: 'Side chat', icon: MessagePlus, component: SideChatTab },
  agents: { title: 'Agents', icon: Hierarchy, component: AgentsTab },
  visual: { title: 'Visual', icon: Chart, component: VisualTab },
  artifacts: { title: 'Artifacts', icon: Layers, component: ArtifactsTab },
} satisfies Record<PaneTabKind, { title: string; icon: IconComponent; component: ComponentType<PaneTabProps> }>;

export function tabTitle(tab: PaneTab) {
  return tab.title ?? PANE_TABS[tab.kind].title;
}
