import {
  BackgroundTask,
  Chart,
  Folder,
  Layers,
  Globe,
  MessagePlus,
  Phone,
  Plug,
  type IconComponent,
  Diff,
  Terminal,
} from '@/icons';
import type { PaneTabKind } from '../model';
import { GitPullRequestIcon } from '../icons/github';

/** Each pane tab's title and icon, apart from its component so the palette's actions can read them while the tabs load. */
export const PANE_TAB_LABELS = {
  browser: { title: 'Preview', icon: Globe },
  changes: { title: 'Changes', icon: Diff },
  terminal: { title: 'Terminal', icon: Terminal },
  files: { title: 'Files', icon: Folder },
  simulator: { title: 'Simulator', icon: Phone },
  ports: { title: 'Ports', icon: Plug },
  sidechat: { title: 'Side chat', icon: MessagePlus },
  agents: { title: 'Background tasks', icon: BackgroundTask },
  visual: { title: 'Visual', icon: Chart },
  artifacts: { title: 'Artifacts', icon: Layers },
  pr: { title: 'Pull request', icon: GitPullRequestIcon },
} satisfies Record<PaneTabKind, { title: string; icon: IconComponent }>;
