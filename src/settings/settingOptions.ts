import { SEARCH_ENGINES } from '../browser/url.ts';
import { HARNESS_IDS, HARNESSES } from './harnesses.ts';
import type { AgentControl, Prefs, ThreadModels } from './prefs.ts';

export const MOTION = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

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

export const WHILE_WORKING = [
  { value: 'queue', label: 'Queue until it finishes' },
  { value: 'steer', label: 'Send right away (steer)' },
] as const;

export const BRANCH_FROM = [
  { value: 'current', label: 'Current branch' },
  { value: 'base', label: 'Base branch' },
] as const;

export const ENGINES = (Object.keys(SEARCH_ENGINES) as Prefs['searchEngine'][]).map((id) => ({ value: id, label: SEARCH_ENGINES[id].name }));

export const AGENTS = HARNESS_IDS.map((id) => ({ value: id, label: HARNESSES[id].name }));

export const AGENT_CONTROL = {
  label: 'Agents can change Mochi',
  options: [
    { value: 'read', label: 'Read only' },
    { value: 'changes', label: 'Changes, never deletes or settings' },
    { value: 'everything', label: 'Everything, asking before deletes and settings' },
  ],
} as const satisfies { label: string; options: readonly { value: AgentControl; label: string }[] };

export const THREAD_MODELS = {
  label: 'Models for threads agents start',
  options: [
    { value: 'cheaper', label: 'Default or cheaper' },
    { value: 'any', label: 'Any model' },
    { value: 'default', label: 'Always the default' },
  ],
} as const satisfies { label: string; options: readonly { value: ThreadModels; label: string }[] };
