import { randomInt } from 'node:crypto';
import { fillName, type CaptureKind, type SetupRecipe, type SetupResult, type SetupTarget } from '../../src/library/recipes.ts';

/** What a run does to a page; Playwright's in the app (`playwrightOps`), a fake in tests. */
export interface RecipeOps {
  url(): string;
  goto(url: string): Promise<void>;
  click(target: SetupTarget): Promise<void>;
  fill(target: SetupTarget, value: string, submit: boolean): Promise<void>;
  /** Opens the combobox or select and lists its enabled options by name, leaving it open for `pick` or `close`. */
  options(target: SetupTarget): Promise<string[]>;
  pick(option: string): Promise<void>;
  close(): Promise<void>;
  waitForText(text: string, timeoutMs: number): Promise<void>;
  isPresent(target: SetupTarget, timeoutMs: number): Promise<boolean>;
  /** The element's value, else what clicking it copies, whichever `isValid`; '' when neither is. */
  capture(target: SetupTarget, isValid: (value: string) => boolean): Promise<string>;
}

const VALID: Record<CaptureKind, (value: string) => boolean> = {
  slackConfigToken: (v) => v.startsWith('xoxe'),
  slackClientId: (v) => /^\d+\.\d+$/.test(v),
  slackClientSecret: (v) => /^[0-9a-f]{32}$/i.test(v),
  googleClientId: (v) => v.endsWith('.apps.googleusercontent.com'),
  googleClientSecret: (v) => v.startsWith('GOCSPX-'),
};

const WAIT_MS = 60_000;
// Long enough for a page that has loaded to show an element; a jump's "no" costs this much.
const PRESENT_MS = 3000;

/** Runs `recipe` from `fromStep` (or the top) to the end, or to the first step that needs the user or fails. */
export async function runRecipe(recipe: SetupRecipe, params: Record<string, string>, ops: RecipeOps, fromStep?: string) {
  const values = { ...params };
  for (const [key, param] of Object.entries(recipe.params)) if (param.generate === 'suffix' && !values[key]) values[key] = String(randomInt(100_000, 1_000_000));
  // Defaults that name another param ({email}) wait for it: a choose step may set it mid-run.
  const fillDefaults = () => {
    for (const [key, param] of Object.entries(recipe.params)) if (!values[key] && param.default !== undefined) values[key] = fillName(param.default, values);
  };
  fillDefaults();
  const captured: Partial<Record<CaptureKind, string>> = {};
  const start = fromStep ? recipe.steps.findIndex((s) => s.id === fromStep) : 0;
  if (start < 0) throw new Error(`No step ${fromStep}; its steps are ${recipe.steps.map((s) => s.id).join(', ')}`);
  const own = () => Object.fromEntries(Object.keys(recipe.params).flatMap((k) => (values[k] ? [[k, values[k]]] : [])));
  for (let i = start; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];
    fillDefaults();
    const target = 'target' in step ? fill(step.target, values) : undefined;
    const stop = (reason: string) => ({ result: { status: 'stopped', stepId: step.id, note: step.note, kind: step.kind, target, nextStepId: recipe.steps[i + 1]?.id, reason } satisfies SetupResult, captured, params: own() });
    const needs = (param: string, options: string[]) => ({ result: { status: 'needs', stepId: step.id, param, question: recipe.params[param]?.question ?? `Which ${param}?`, options } satisfies SetupResult, captured, params: own() });
    try {
      if (step.kind === 'end') break;
      if (step.kind === 'ask') {
        if (!values[step.param]) return needs(step.param, recipe.params[step.param]?.options ?? []);
        continue;
      }
      if (step.kind === 'goto') await ops.goto(fillName(step.url, values));
      if (!isOn(ops.url(), recipe.domains)) return stop(`The page left ${recipe.domains.join(', ')} (now ${hostOf(ops.url())}): the user may need to sign in there first`);
      if (step.kind === 'click') await ops.click(target!);
      if (step.kind === 'fill') await ops.fill(target!, fillName(step.value, values), !!step.submit);
      if (step.kind === 'wait') await ops.waitForText(fillName(step.text, values), step.timeoutMs ?? WAIT_MS);
      if (step.kind === 'jumpIfPresent' && (await ops.isPresent(target!, PRESENT_MS))) i = recipe.steps.findIndex((s) => s.id === step.to) - 1;
      if (step.kind === 'stopIf' && (await ops.isPresent(target!, PRESENT_MS))) return stop(fillName(step.reason, values));
      if (step.kind === 'choose') {
        const options = await ops.options(target!);
        const value = values[step.param] ?? (options.length === 1 ? options[0] : undefined);
        if (!value || !options.includes(value)) {
          await ops.close();
          return needs(step.param, options);
        }
        await ops.pick(value);
        values[step.param] = value;
      }
      if (step.kind === 'capture') {
        const value = await ops.capture(target!, VALID[step.as]);
        if (!value) return stop('That element held nothing Mochi could keep (no value, and clicking it copied nothing usable)');
        captured[step.as] = value;
      }
    } catch (error) {
      return stop((error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300));
    }
  }
  return { result: { status: 'done', captured: Object.keys(captured) as CaptureKind[], params: own() } satisfies SetupResult, captured, params: own() };
}

function fill(target: SetupTarget, params: Record<string, string>): SetupTarget {
  return { ...target, ...(target.name && { name: fillName(target.name, params) }), ...(target.within && { within: fill(target.within, params) }) };
}

function isOn(url: string, domains: string[]) {
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname : url);
