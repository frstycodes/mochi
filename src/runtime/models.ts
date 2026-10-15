import type { AgentModel, AgentSpeed } from '../host/types/agent.ts';
import type { Provider } from '../model.ts';
import { HARNESSES } from '../settings/harnesses.ts';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Demo data for the web build and tests, never a real account's list: the current family, Opus as default. No speeds. */
export const CLAUDE_DEMO_MODELS: AgentModel[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'Best for everyday, complex tasks', efforts: CLAUDE_EFFORTS, speeds: [], isDefault: true },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', description: 'Efficient for routine tasks', efforts: CLAUDE_EFFORTS, speeds: [], isDefault: false },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', description: 'Fastest for quick answers', efforts: CLAUDE_EFFORTS, speeds: [], isDefault: false },
];

/**
 * Claude fast mode's API price per model, from Anthropic's pricing docs and Claude Code 2.1.296's own cost table; both put
 * it at 2x standard. GAP: a model missing here gets a note without a price.
 */
const CLAUDE_FAST_PRICES: Record<string, string> = {
  'claude-opus-5-5': '$8 / $40 per Mtok',
  'claude-opus-5': '$10 / $50 per Mtok',
  'claude-opus-4-8': '$10 / $50 per Mtok',
};

/** Claude Code's fast mode for a model whose `supportedModels()` row says `supportsFastMode`. */
export function claudeFast(id: string): AgentSpeed {
  const price = CLAUDE_FAST_PRICES[id];
  return { id: 'fast', name: 'Fast', description: price ? `Up to 2.5x faster output, 2x the price (${price})` : 'Up to 2.5x faster output, at a higher price' };
}

/** What Settings' default speed and a thread's control store: '' standard, 'fast' the model's first faster tier, or a tier id. */
export const FAST = 'fast';

/** The tier a run on `model` gets: the chosen id when the model lists it, its first tier for `fast`, else none (standard). */
export function speedFor(model: AgentModel, speed: string | undefined) {
  if (!speed) return;
  return (model.speeds.find((s) => s.id === speed) ?? (speed === FAST ? model.speeds[0] : undefined))?.id;
}

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
 * no longer offers never reaches the provider. An empty list (it couldn't be read) passes model and effort through, but
 * never a speed: only a model that reports a tier gets one.
 */
export function resolveRun(models: AgentModel[], model: string | undefined, effort: string | undefined, speed?: string): { model: string | undefined; effort: string | undefined; speed?: string } {
  const picked = models.find((m) => m.id === model) ?? defaultModelOf(models);
  if (!picked) return { model, effort };
  const tier = speedFor(picked, speed);
  return { model: picked.id, effort: effortFor(picked, effort), ...(tier && { speed: tier }) };
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
  if (!models) return { id, harness, name: id || 'Default model', description: '', efforts: [], speeds: [], isDefault: false };
  return { id, harness, name: id, description: fallback ? `Unavailable, runs ${fallback.name}` : 'Unavailable', efforts: fallback?.efforts ?? [], defaultEffort: fallback?.defaultEffort, speeds: fallback?.speeds ?? [], isDefault: false, isUnavailable: true };
}

/**
 * Harnesses the picker lists: set up (no `unavailable` reason) and answered with a non-empty model list. A harness whose
 * list hasn't arrived stays, so its row can say it's loading; one whose query failed (`[]`) is dropped.
 */
export function listedHarnesses(harnesses: Provider[], catalog: Partial<Record<Provider, AgentModel[]>>, unavailable: Partial<Record<Provider, string>>) {
  return harnesses.filter((h) => !unavailable[h] && catalog[h]?.length !== 0);
}

/** Models whose harness, name or id contains every typed word as written; cmdk's fuzzy default found "luna" in "cLaUde soNnet". */
export function searchModels(models: ModelOption[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    const text = `${HARNESSES[m.harness].name} ${m.name} ${m.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
