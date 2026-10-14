import type { ComponentType } from 'react';
import { Chart, Code, Edit, Folder, Global, Hierarchy, MessageAdd, Mobile, Plug, type IconComponent } from 'reicon-react';
import type { Pane, PaneTab, PaneTabKind, Thread } from '../model';
import { AgentsTab } from './AgentsTab';
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
  browser: { title: 'Preview', icon: Global, component: BrowserTab },
  changes: { title: 'Changes', icon: Edit, component: ChangesTab },
  terminal: { title: 'Terminal', icon: Code, component: TerminalTab },
  files: { title: 'Files', icon: Folder, component: FilesTab },
  simulator: { title: 'Simulator', icon: Mobile, component: SimulatorTab },
  ports: { title: 'Ports', icon: Plug, component: PortsTab },
  sidechat: { title: 'Side chat', icon: MessageAdd, component: SideChatTab },
  agents: { title: 'Agents', icon: Hierarchy, component: AgentsTab },
  visual: { title: 'Visual', icon: Chart, component: VisualTab },
} satisfies Record<PaneTabKind, { title: string; icon: IconComponent; component: ComponentType<PaneTabProps> }>;

export function tabTitle(tab: PaneTab) {
  return tab.title ?? PANE_TABS[tab.kind].title;
}

/** The letter that, with mod Alt, toggles each pane: mnemonic, and clear of the browser's and macOS's own mod Alt keys. */
export const PANE_SHORTCUTS = {
  browser: 'P',
  changes: 'D',
  terminal: 'T',
  files: 'F',
  simulator: 'S',
  ports: 'O',
  sidechat: 'C',
  agents: 'A',
} satisfies Partial<Record<PaneTabKind, string>>;

export function paneShortcut(kind: keyof typeof PANE_SHORTCUTS) {
  return ['mod', 'alt', PANE_SHORTCUTS[kind]];
}
