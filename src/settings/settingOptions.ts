import { SEARCH_ENGINES } from '../browser/url.ts';
import { EFFORTS } from '../runtime/controls.ts';
import { HARNESS_IDS, HARNESSES } from './harnesses.ts';
import type { AgentControl, Prefs } from './prefs.ts';

type Option = { readonly value: string; readonly label: string };

const SWITCH = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
] as const;

export const MOTION = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

export const DIFF_STYLES = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const;

export const BRANCH_FROM = [
  { value: 'current', label: 'Current branch' },
  { value: 'base', label: 'Base branch' },
] as const;

export const ENGINES = (Object.keys(SEARCH_ENGINES) as Prefs['searchEngine'][]).map((id) => ({ value: id, label: SEARCH_ENGINES[id].name }));

export const AGENTS = HARNESS_IDS.map((id) => ({ value: id, label: HARNESSES[id].name }));

/**
 * The prefs an agent may read (`get_settings`) and propose (`update_setting`, which waits on the user). Never
 * `agentControl` or `permissions`: an agent can't widen its own reach.
 */
export const AGENT_SETTINGS = {
  reduceMotion: { label: 'Reduce motion', options: MOTION },
  effort: { label: 'Default effort', options: EFFORTS.map((value) => ({ value, label: value })) },
  agent: { label: 'Agent', options: AGENTS },
  branchFrom: { label: 'Off-goal work branches from', options: BRANCH_FROM },
  diffStyle: { label: 'Diffs', options: DIFF_STYLES },
  searchEngine: { label: 'Search engine', options: ENGINES },
  driftGuard: { label: 'Drift guard', options: SWITCH },
  restoreLayout: { label: 'Restore layout on launch', options: SWITCH },
  restoreTerminals: { label: 'Restore terminals on launch', options: SWITCH },
  watchedToasts: { label: 'Toasts for watched threads', options: SWITCH },
  dockBadge: { label: 'Dock badge counts', options: SWITCH },
} satisfies Partial<Record<keyof Prefs, { label: string; options: readonly Option[] }>>;

export type AgentSettingKey = keyof typeof AGENT_SETTINGS;

export const AGENT_SETTING_KEYS = Object.keys(AGENT_SETTINGS) as [AgentSettingKey, ...AgentSettingKey[]];

export const isSwitch = (key: WidgetSettingKey) => WIDGET_SETTINGS[key].options === SWITCH;

/** The pref as the string its options use. */
export const settingValue = (prefs: Prefs, key: WidgetSettingKey) => String(prefs[key]);

export const optionLabel = (key: WidgetSettingKey, value: string) => (WIDGET_SETTINGS[key].options as readonly Option[]).find((o) => o.value === value)?.label ?? value;

/** The patch that sets `key` to the option `value`, or null when `value` isn't one of its options. */
export function settingPatch(key: WidgetSettingKey, value: string): Partial<Prefs> | null {
  if (!(WIDGET_SETTINGS[key].options as readonly Option[]).some((o) => o.value === value)) return null;
  return { [key]: isSwitch(key) ? value === 'true' : value };
}

export const AGENT_CONTROL = {
  label: 'Agents can change Mochi',
  options: [
    { value: 'read', label: 'Read only' },
    { value: 'changes', label: 'Changes, never deletes or settings' },
    { value: 'everything', label: 'Everything, asking before deletes and settings' },
  ],
} as const satisfies { label: string; options: readonly { value: AgentControl; label: string }[] };

/** Every setting a widget can show: the ones agents propose, plus the agent-control level a blocked call points at. */
export const WIDGET_SETTINGS = { ...AGENT_SETTINGS, agentControl: AGENT_CONTROL };

export type WidgetSettingKey = keyof typeof WIDGET_SETTINGS;

export const isWidgetSetting = (id: string): id is WidgetSettingKey => Object.hasOwn(WIDGET_SETTINGS, id);
