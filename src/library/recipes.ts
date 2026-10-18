import shipped from '../../recipes/setup.json' with { type: 'json' };

/**
 * Setup recipes (LIBRARY.md › Bring your own app): a service's one-time app setup as data, which Mochi runs in main on the
 * agent's browser tab in seconds instead of the agent clicking through it. Steps come from a fixed set and visit only the
 * recipe's own domains; elements are found by ARIA role and name. When a page changes and a step's element is gone, the
 * agent does that step itself and saves the role and name that worked as the user's override (`update_setup_step`):
 * overrides change targets only, never a step's kind, URL or the domains, and a new shipped version of the recipe drops them.
 */
export interface SetupRecipe {
  version: number;
  /** Hosts the page may be on while steps run (subdomains included); leaving them stops the run. */
  domains: string[];
  /** Values a run uses: asked from the user when missing (a `choose` or `ask` step), or made up by Mochi (`generate`). */
  params: Record<string, RecipeParam>;
  steps: SetupStep[];
}

export interface RecipeParam {
  question?: string;
  /** The answers an `ask` step offers, like "I agree". */
  options?: string[];
  /** Filled in by Mochi when the run doesn't pass it: six random digits, for an id like `mochi-{suffix}`. */
  generate?: 'suffix';
}

/** An element by ARIA role and accessible name (`{param}` filled in from the run's params), optionally inside another; no name matches the first of the role. */
export interface SetupTarget {
  role: string;
  name?: string;
  exact?: boolean;
  within?: SetupTarget;
}

export type SetupStep = { id: string; note: string } & (
  /** `{param}`s may fill its path and query; its host is fixed. */
  | { kind: 'goto'; url: string }
  | { kind: 'click'; target: SetupTarget }
  /** Types literal text (with `{param}`s, never a secret); `submit` presses Enter after, as chip fields need. */
  | { kind: 'fill'; target: SetupTarget; value: string; submit?: boolean }
  /** Opens a combobox (or select) and picks the enabled option named by `param`; with one option and no param, picks it. */
  | { kind: 'choose'; target: SetupTarget; param: string }
  /** A decision only the user makes, like agreeing to a policy: the run stops to ask unless `param` is answered. */
  | { kind: 'ask'; param: string }
  /** Waits for text to show, for a slow page (creating a project, enabling APIs). */
  | { kind: 'wait'; text: string; timeoutMs?: number }
  /** Goes on at step `to` when the element shows within a few seconds, like an app that already exists. */
  | { kind: 'jumpIfPresent'; target: SetupTarget; to: string }
  /** Reads a secret into main, from the element's value or what clicking it copies. */
  | { kind: 'capture'; target: SetupTarget; as: CaptureKind }
  /** Ends the run here, done; for the branch before a jump's target. */
  | { kind: 'end' }
);

export type CaptureKind = 'slackConfigToken' | 'slackClientId' | 'slackClientSecret' | 'googleClientId' | 'googleClientSecret';

/** What a run ended with; never a captured value. `params` are its own (a workspace, a project id), none secret. */
export type SetupResult =
  | { status: 'done'; captured: CaptureKind[]; params: Record<string, string> }
  | { status: 'needs'; stepId: string; param: string; question: string; options: string[] }
  | { status: 'stopped'; stepId: string; note: string; kind: SetupStep['kind']; target?: SetupTarget; nextStepId?: string; reason: string };

/**
 * Sites each connector's recipe may visit. A recipe from the repo (`recipes/setup.json`, fetched by main) must stay within
 * them, so only an app release can send a recipe somewhere new.
 */
export const RECIPE_DOMAINS: Partial<Record<string, string[]>> = { slack: ['api.slack.com', 'app.slack.com'], 'google-workspace': ['console.cloud.google.com'] };

/** Where recipes live; main fetches this path so a fix reaches every install without a release. */
export const RECIPES_REPO = 'frstycodes/mochi';
export const RECIPES_PATH = 'recipes/setup.json';

const STEP_KINDS = ['goto', 'click', 'fill', 'choose', 'ask', 'wait', 'jumpIfPresent', 'capture', 'end'] as const;
const CAPTURE_KINDS = ['slackConfigToken', 'slackClientId', 'slackClientSecret', 'googleClientId', 'googleClientSecret'] as const satisfies CaptureKind[];

/** The recipes this build ships, the fallback when the repo's can't be read. Labels read from api.slack.com/apps on 2026-10-18. */
export const BUILT_IN_RECIPES = parseRecipes(shipped, false);

/** Every connector's recipe that passes `parseRecipe`; with `lenient`, a bad one is left out rather than failing all. */
export function parseRecipes(value: unknown, lenient = true): Partial<Record<string, SetupRecipe>> {
  if (!value || typeof value !== 'object') throw new TypeError('recipes must be an object of connector ids');
  const recipes: Partial<Record<string, SetupRecipe>> = {};
  for (const [connector, raw] of Object.entries(value)) {
    try {
      recipes[connector] = parseRecipe(connector, raw);
    } catch (error) {
      if (!lenient) throw error;
    }
  }
  return recipes;
}

/** A recipe as data: known step kinds, targets by role and name, every URL and domain within `RECIPE_DOMAINS`. */
export function parseRecipe(connector: string, value: unknown): SetupRecipe {
  const allowed = RECIPE_DOMAINS[connector];
  if (!allowed) throw new TypeError(`${connector} has no allowed domains in this build`);
  const r = value as Partial<SetupRecipe> | null;
  if (!r || typeof r !== 'object') throw new TypeError(`${connector}: a recipe must be an object`);
  if (!Number.isInteger(r.version) || r.version! < 1) throw new TypeError(`${connector}: version must be a positive integer`);
  if (!Array.isArray(r.domains) || !r.domains.length || r.domains.some((d) => !allowed.includes(d))) throw new TypeError(`${connector}: domains must be within ${allowed.join(', ')}`);
  const params = Object.fromEntries(Object.entries(r.params ?? {}).map(([k, raw]) => [k, parseParam(connector, k, raw)]));
  const declared = (text: string, where: string) => {
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!(key in params)) throw new TypeError(`${connector}: ${where} uses an undeclared param ${key}`);
    return text;
  };
  const targetOf = (value: unknown, where: string) => {
    const target = parseTarget(value);
    for (let t: SetupTarget | undefined = target; t; t = t.within) if (t.name) declared(t.name, where);
    return target;
  };
  if (!Array.isArray(r.steps) || !r.steps.length || r.steps.length > 40) throw new TypeError(`${connector}: steps must be 1 to 40`);
  const ids = r.steps.map((raw) => (raw as { id?: unknown }).id);
  if (ids.some((id, i) => typeof id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(id) || ids.indexOf(id) !== i)) throw new TypeError(`${connector}: step ids must be unique lowercase words`);
  const steps = r.steps.map((raw, index): SetupStep => {
    const s = raw as Record<string, unknown> & { id: string; kind?: string };
    const base = { id: s.id, note: shortText(s.note, `${connector}: ${s.id}.note`) };
    if (!STEP_KINDS.includes(s.kind as (typeof STEP_KINDS)[number])) throw new TypeError(`${connector}: ${s.id} has an unknown kind`);
    const where = `${s.id}`;
    switch (s.kind) {
      case 'goto': {
        const raw = typeof s.url === 'string' ? declared(s.url, where) : '';
        const url = URL.canParse(raw.replace(/\{(\w+)\}/g, 'x')) ? new URL(raw.replace(/\{(\w+)\}/g, 'x')) : null;
        if (!url || url.protocol !== 'https:' || !r.domains!.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))) throw new TypeError(`${connector}: ${s.id} must go to https on ${r.domains!.join(', ')}`);
        return { ...base, kind: 'goto', url: raw };
      }
      case 'click':
        return { ...base, kind: 'click', target: targetOf(s.target, where) };
      case 'fill':
        return { ...base, kind: 'fill', target: targetOf(s.target, where), value: declared(shortText(s.value, `${connector}: ${s.id}.value`), where), ...(s.submit === true && { submit: true }) };
      case 'choose':
      case 'ask':
        if (typeof s.param !== 'string' || !(s.param in params)) throw new TypeError(`${connector}: ${s.id} uses an undeclared param`);
        return s.kind === 'choose' ? { ...base, kind: 'choose', target: targetOf(s.target, where), param: s.param } : { ...base, kind: 'ask', param: s.param };
      case 'wait': {
        const timeoutMs = s.timeoutMs === undefined ? undefined : Number(s.timeoutMs);
        if (timeoutMs !== undefined && !(timeoutMs > 0 && timeoutMs <= 120_000)) throw new TypeError(`${connector}: ${s.id} waits up to 120000 ms`);
        return { ...base, kind: 'wait', text: declared(shortText(s.text, `${connector}: ${s.id}.text`), where), ...(timeoutMs && { timeoutMs }) };
      }
      case 'jumpIfPresent':
        if (typeof s.to !== 'string' || ids.indexOf(s.to) <= index) throw new TypeError(`${connector}: ${s.id} jumps to a later step`);
        return { ...base, kind: 'jumpIfPresent', target: targetOf(s.target, where), to: s.to };
      case 'capture':
        if (!CAPTURE_KINDS.includes(s.as as CaptureKind)) throw new TypeError(`${connector}: ${s.id} captures an unknown kind`);
        return { ...base, kind: 'capture', target: targetOf(s.target, where), as: s.as as CaptureKind };
      default:
        return { ...base, kind: 'end' };
    }
  });
  return { version: r.version!, domains: [...r.domains], params, steps };
}

function parseParam(connector: string, key: string, raw: unknown): RecipeParam {
  const p = (raw ?? {}) as Record<string, unknown>;
  const options = p.options;
  if (options !== undefined && (!Array.isArray(options) || !options.length || options.some((o) => typeof o !== 'string' || o.length > 100))) throw new TypeError(`${connector}: params.${key}.options must be short texts`);
  if (p.generate !== undefined && p.generate !== 'suffix') throw new TypeError(`${connector}: params.${key}.generate must be suffix`);
  return {
    ...(p.question !== undefined && { question: shortText(p.question, `${connector}: params.${key}.question`) }),
    ...(options && { options: options as string[] }),
    ...(p.generate === 'suffix' && { generate: 'suffix' as const }),
  };
}

function shortText(value: unknown, what: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new TypeError(`${what} must be text up to 200 characters`);
  return value;
}

/** The user's overrides for a recipe: step id → target, for the recipe version they were made against. */
export interface RecipeOverrides {
  version: number;
  targets: Record<string, SetupTarget>;
}

/** The recipe with the user's targets in place; overrides from another version are stale and ignored. */
export function withOverrides(recipe: SetupRecipe, overrides: RecipeOverrides | undefined): SetupRecipe {
  if (!overrides || overrides.version !== recipe.version) return recipe;
  return { ...recipe, steps: recipe.steps.map((step) => ('target' in step && overrides.targets[step.id] ? { ...step, target: overrides.targets[step.id] } : step)) };
}

/** A target as an agent may send it: a lowercase ARIA role, a short name, at most one level of `within`. */
export function parseTarget(value: unknown, depth = 0): SetupTarget {
  const t = value as Partial<SetupTarget> | null;
  if (!t || typeof t !== 'object') throw new TypeError('target must be { role, name?, exact?, within? }');
  if (typeof t.role !== 'string' || !/^[a-z]{2,24}$/.test(t.role)) throw new TypeError('target.role must be an ARIA role, like button or combobox');
  if (t.name !== undefined && (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 200)) throw new TypeError('target.name must be the accessible name, up to 200 characters');
  if (t.exact !== undefined && typeof t.exact !== 'boolean') throw new TypeError('target.exact must be a boolean');
  if (t.within !== undefined && depth > 0) throw new TypeError('target.within nests one level at most');
  return { role: t.role, ...(t.name !== undefined && { name: t.name.trim() }), ...(t.exact !== undefined && { exact: t.exact }), ...(t.within !== undefined && { within: parseTarget(t.within, depth + 1) }) };
}

/** `{param}` placeholders in a name, filled from the run's params; a missing one stays as written. */
export function fillName(name: string, params: Record<string, string>) {
  return name.replace(/\{(\w+)\}/g, (whole, key: string) => params[key] ?? whole);
}
