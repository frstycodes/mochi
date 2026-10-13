import type { AgentModel } from '../host/types/agent.ts';
import type { Provider } from '../model.ts';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Claude's list when `supportedModels()` fails (Claude Code missing, a slow start): the current family, Opus as default. */
export const CLAUDE_FALLBACK_MODELS: AgentModel[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'Best for everyday, complex tasks', efforts: CLAUDE_EFFORTS, isDefault: true },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', description: 'Efficient for routine tasks', efforts: CLAUDE_EFFORTS, isDefault: false },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', description: 'Fastest for quick answers', efforts: CLAUDE_EFFORTS, isDefault: false },
];

const EFFORT_NAMES: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

/** Efforts cheapest first; -1 for one Mochi doesn't know. */
export const effortRank = (effort: string) => Object.keys(EFFORT_NAMES).indexOf(effort);

// GAP: only Claude's families are ranked; a Codex model other than the default reads as unranked, so the ceiling refuses it.
const CLAUDE_FAMILIES = ['haiku', 'sonnet', 'opus'];

/** A model's cost tier, cheapest 0; undefined when Mochi can't rank it. */
export function modelTier(id: string) {
  const tier = CLAUDE_FAMILIES.findIndex((family) => id.includes(family));
  return tier < 0 ? undefined : tier;
}

export const effortName = (effort: string) => EFFORT_NAMES[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);

/** Threads and prefs saved before efforts came from the provider hold the chip's label ('Extra high'). */
export const effortId = (effort: string) => Object.keys(EFFORT_NAMES).find((id) => EFFORT_NAMES[id] === effort) ?? effort;

/** Catalog ids from before the catalog came from the providers; Codex's never named a real model, so they read as unavailable. */
const LEGACY_MODELS: Record<string, string> = { 'opus-5.5': 'claude-opus-5-5', 'sonnet-5.5': 'claude-sonnet-5-5', 'haiku-5.5': 'claude-haiku-5-5' };

export const modelId = (id: string) => LEGACY_MODELS[id] ?? id;

/** A context window to show before the agent reports its model's own (`usage` events carry `contextMax`). */
export const contextMax = (provider: Provider) => (provider === 'codex' ? 272_000 : 200_000);

export const defaultModelOf = (models: AgentModel[]) => models.find((m) => m.isDefault) ?? models[0];

/** The effort a run on `model` gets: the chosen one when the model takes it, else the provider's default for it. */
export const effortFor = (model: AgentModel, effort: string | undefined) => (effort && model.efforts.includes(effort) ? effort : model.defaultEffort);

/**
 * What a run sends: the chosen model when the account offers it, else the account's default, so a model the account
 * no longer offers never reaches the provider. An empty list (it couldn't be read) passes the choice through.
 */
export function resolveRun(models: AgentModel[], model: string | undefined, effort: string | undefined) {
  const picked = models.find((m) => m.id === model) ?? defaultModelOf(models);
  if (!picked) return { model, effort };
  return { model: picked.id, effort: effortFor(picked, effort) };
}

/** A model as the picker lists it. `isUnavailable`: a stored choice the account no longer offers; runs use the default instead. */
export interface ModelOption extends AgentModel {
  harness: Provider;
  isUnavailable?: boolean;
}

/**
 * What the picker shows for a stored choice: '' is the account's default model, an id the loaded list lacks is
 * Unavailable (with the default's efforts, since the default is what runs). `models` undefined: the list isn't loaded yet.
 */
export function optionFor(models: AgentModel[] | undefined, id: string, harness: Provider): ModelOption {
  const fallback = models && defaultModelOf(models);
  const listed = models?.find((m) => m.id === id) ?? (id ? undefined : fallback);
  if (listed) return { ...listed, harness };
  if (!models) return { id, harness, name: id || 'Default model', description: '', efforts: [], isDefault: false };
  return { id, harness, name: id, description: fallback ? `Unavailable, runs ${fallback.name}` : 'Unavailable', efforts: fallback?.efforts ?? [], defaultEffort: fallback?.defaultEffort, isDefault: false, isUnavailable: true };
}
