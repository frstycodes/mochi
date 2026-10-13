import type { ComponentType } from 'react';
import { Add, Chart, Code, Edit, Folder, Global, Hierarchy, MessageAdd, Mobile, Plug, type IconComponent } from 'reicon-react';
import type { Pane, PaneTab, PaneTabKind, Thread } from '../model';
import { AgentsTab } from './AgentsTab';
import { BrowserTab } from './BrowserTab';
import { ChangesTab } from './ChangesTab';
import { FilesTab } from './FilesTab';
import { NewTab } from './NewTab';
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
  browser: { title: 'Preview', icon: Global, component: BrowserTab },
  changes: { title: 'Changes', icon: Edit, component: ChangesTab },
  terminal: { title: 'Terminal', icon: Code, component: TerminalTab },
  files: { title: 'Files', icon: Folder, component: FilesTab },
  simulator: { title: 'Simulator', icon: Mobile, component: SimulatorTab },
  ports: { title: 'Ports', icon: Plug, component: PortsTab },
  sidechat: { title: 'Side chat', icon: MessageAdd, component: SideChatTab },
  agents: { title: 'Agents', icon: Hierarchy, component: AgentsTab },
  visual: { title: 'Visual', icon: Chart, component: VisualTab },
  new: { title: 'New tab', icon: Add, component: NewTab },
} satisfies Record<PaneTabKind, { title: string; icon: IconComponent; component: ComponentType<PaneTabProps> }>;

export function tabTitle(tab: PaneTab) {
  return tab.title ?? PANE_TABS[tab.kind].title;
}

/** Why a tab kind can't open as its own split, shown on the drop zone while dragging it; undefined when it can. */
export function splitRefusal(kind: PaneTabKind) {
  return kind === 'new' ? "A new tab can't open in a split. Pick what it shows first." : undefined;
}
