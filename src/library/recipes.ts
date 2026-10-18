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
  /** Values a run needs from the user, asked when missing; a `choose` step picks the option named by one. */
  params: Record<string, { question: string }>;
  steps: SetupStep[];
}

/** An element by ARIA role and accessible name (`{param}` filled in from the run's params), optionally inside another. */
export interface SetupTarget {
  role: string;
  name: string;
  exact?: boolean;
  within?: SetupTarget;
}

export type SetupStep = { id: string; note: string } & (
  | { kind: 'goto'; url: string }
  | { kind: 'click'; target: SetupTarget }
  /** Opens a combobox (or select) and picks the option named by `param`; with one option and no param, picks it. */
  | { kind: 'choose'; target: SetupTarget; param: string }
  /** Reads a secret into main, from the element's value or what clicking it copies. */
  | { kind: 'capture'; target: SetupTarget; as: CaptureKind }
);

export type CaptureKind = 'slackConfigToken';

/** What a run ended with; never a captured value. */
export type SetupResult =
  | { status: 'done'; captured: CaptureKind[] }
  | { status: 'needs'; param: string; question: string; options: string[] }
  | { status: 'stopped'; stepId: string; note: string; kind: SetupStep['kind']; target?: SetupTarget; nextStepId?: string; reason: string };

export const SETUP_RECIPES: Partial<Record<string, SetupRecipe>> = {
  // Labels read from api.slack.com/apps on 2026-10-18. The token feeds `apps.manifest.create` (electron/library/slackApp.ts).
  slack: {
    version: 1,
    domains: ['api.slack.com'],
    params: { workspace: { question: 'Which Slack workspace should Mochi connect to?' } },
    steps: [
      { id: 'open', kind: 'goto', url: 'https://api.slack.com/apps', note: 'Your Apps, where app configuration tokens are made' },
      { id: 'generate', kind: 'click', target: { role: 'button', name: 'Generate Token', exact: true }, note: 'Opens "Generate Your App Configuration Token"' },
      { id: 'workspace', kind: 'choose', target: { role: 'combobox', name: 'Select a team' }, param: 'workspace', note: 'Picks the workspace' },
      { id: 'confirm', kind: 'click', target: { role: 'button', name: 'Generate', exact: true }, note: 'Generates the token' },
      { id: 'copy', kind: 'capture', target: { role: 'button', name: 'Copy access token', within: { role: 'row', name: '{workspace}' } }, as: 'slackConfigToken', note: "Copies the workspace's new access token into Mochi" },
    ],
  },
};

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
  if (!t || typeof t !== 'object') throw new TypeError('target must be { role, name, exact?, within? }');
  if (typeof t.role !== 'string' || !/^[a-z]{2,24}$/.test(t.role)) throw new TypeError('target.role must be an ARIA role, like button or combobox');
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 200) throw new TypeError('target.name must be the accessible name, up to 200 characters');
  if (t.exact !== undefined && typeof t.exact !== 'boolean') throw new TypeError('target.exact must be a boolean');
  if (t.within !== undefined && depth > 0) throw new TypeError('target.within nests one level at most');
  return { role: t.role, name: t.name.trim(), ...(t.exact !== undefined && { exact: t.exact }), ...(t.within !== undefined && { within: parseTarget(t.within, depth + 1) }) };
}

/** `{param}` placeholders in a name, filled from the run's params; a missing one stays as written. */
export function fillName(name: string, params: Record<string, string>) {
  return name.replace(/\{(\w+)\}/g, (whole, key: string) => params[key] ?? whole);
}
