import { SEARCH_ENGINES } from '../browser/url.ts';
import { HARNESS_IDS, HARNESSES } from './harnesses.ts';
import type { AgentControl, Prefs } from './prefs.ts';

export type FontKind = 'ui' | 'mono';

/** What an empty font pref shows as: the bundled Inter, or the OS's own monospace. */
export const DEFAULT_FONT_LABEL = {
  ui: 'Inter',
  mono: 'System monospace',
} satisfies Record<FontKind, string>;

export const UI_TEXT_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
] as const;

export const MOTION = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

/** Settings › Appearance › Animations: each item's id is also a word in `data-animations` on <html> (index.css). */
export const ANIMATIONS = {
  sidebar: {
    label: 'Sidebar animations',
    description: 'Showing, hiding and peeking',
    items: [
      {
        value: 'sidebar-toggle',
        label: 'Show and hide',
        description: 'The docked sidebar slides when you toggle it',
      },
      {
        value: 'sidebar-peek',
        label: 'Peek',
        description: 'The floating sidebar slides in from the left edge',
      },
    ],
  },
  pane: {
    label: 'Side pane animations',
    description: 'Opening, closing, moving and expanding panes',
    items: [
      {
        value: 'pane-slide',
        label: 'First and last pane',
        description: 'Slides in from and out to the right edge',
      },
      {
        value: 'pane-pop',
        label: 'Panes beside others',
        description: 'Scales in on open, fades out on close',
      },
      {
        value: 'pane-layout',
        label: 'Moving and expanding',
        description: 'Panes glide to their new size and place',
      },
    ],
  },
} as const;

export type AnimationArea = keyof typeof ANIMATIONS;

// Values, not '': toggle groups and Radix selects read '' as nothing chosen.
export const SPEEDS = [
  { value: 'standard', label: 'Standard' },
  { value: 'fast', label: 'Fast' },
] as const;

export const DIFF_STYLES = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const;

export const WORKSPACE_MODES = [
  { value: 'worktree', label: 'New worktree' },
  { value: 'folder', label: 'Project folder' },
] as const;

export const WORKTREE_CLEANUP = [
  { value: 'never', label: 'Never' },
  { value: '1', label: 'After 1 day' },
  { value: '7', label: 'After 7 days' },
  { value: '30', label: 'After 30 days' },
] as const;

export const SETTLED_CLEANUP = [
  { value: 'never', label: 'Never' },
  { value: '30', label: 'After 30 days' },
  { value: '90', label: 'After 90 days' },
  { value: '180', label: 'After 180 days' },
] as const;

export const WHILE_WORKING = [
  { value: 'queue', label: 'Queue until it finishes' },
  { value: 'steer', label: 'Send right away (steer)' },
] as const;

export const PROPOSED_GOALS = [
  { value: 'ask', label: 'Ask me to accept' },
  { value: 'apply', label: 'Apply, with undo' },
] as const;

export const IDLE_CHECKS = [
  { value: 'edited', label: 'When the turn edited files' },
  { value: 'always', label: 'After every turn' },
  { value: 'off', label: 'Never' },
] as const;

export const PR_GAPS = [
  { value: 'block', label: 'Block critical, warn the rest' },
  { value: 'warn', label: 'Warn only' },
] as const;

/** Idle verdicts you can be notified about, in Settings' order. Gaps and Done came from goals, which are retired. */
export const IDLE_ALERTS = [
  { value: 'needs-you', label: 'Something for you (a question)' },
  { value: 'stalled', label: 'Stalled' },
] as const;

export const BRANCH_FROM = [
  { value: 'current', label: 'Current branch' },
  { value: 'base', label: 'Base branch' },
] as const;

export const ENGINES = (
  Object.keys(SEARCH_ENGINES) as Prefs['searchEngine'][]
).map((id) => ({ value: id, label: SEARCH_ENGINES[id].name }));

export const AGENTS = HARNESS_IDS.map((id) => ({
  value: id,
  label: HARNESSES[id].name,
}));

export const AGENT_CONTROL = {
  label: 'Agents can change Mochi',
  options: [
    { value: 'read', label: 'Read only' },
    { value: 'changes', label: 'Changes, never deletes or settings' },
    {
      value: 'everything',
      label: 'Everything, asking before deletes and settings',
    },
  ],
} as const satisfies {
  label: string;
  options: readonly { value: AgentControl; label: string }[];
};

/** Settings › Appearance › App icon: each value names `build/icons/<value>.svg` and the `.png` main hands the Dock. */
export const APP_ICONS = [
  { value: 'graphite', label: 'Graphite' },
  { value: 'paper', label: 'Paper' },
  { value: 'sleepy', label: 'Sleepy' },
  { value: 'pixel', label: 'Pixel' },
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'dango', label: 'Dango' },
  { value: 'peek', label: 'Peek' },
  { value: 'sticker', label: 'Sticker' },
  { value: 'riso', label: 'Riso' },
] as const;

export type AppIcon = (typeof APP_ICONS)[number]['value'];
