import { fillName, type CaptureKind, type SetupRecipe, type SetupResult, type SetupTarget } from '../../src/library/recipes.ts';

/** What a run does to a page; Playwright's in the app (`playwrightOps`), a fake in tests. */
export interface RecipeOps {
  url(): string;
  goto(url: string): Promise<void>;
  click(target: SetupTarget): Promise<void>;
  /** Opens the combobox or select and lists its options by name, leaving it open for `pick` or `close`. */
  options(target: SetupTarget): Promise<string[]>;
  pick(option: string): Promise<void>;
  close(): Promise<void>;
  /** The element's value, else what clicking it copies, whichever `isValid`; '' when neither is. */
  capture(target: SetupTarget, isValid: (value: string) => boolean): Promise<string>;
}

const VALID: Record<CaptureKind, (value: string) => boolean> = { slackConfigToken: (v) => v.startsWith('xoxe') };

/** Runs `recipe` from `fromStep` (or the top) to the end, or to the first step that needs the user or fails. */
export async function runRecipe(recipe: SetupRecipe, params: Record<string, string>, ops: RecipeOps, fromStep?: string) {
  const values = { ...params };
  const captured: Partial<Record<CaptureKind, string>> = {};
  const start = fromStep ? recipe.steps.findIndex((s) => s.id === fromStep) : 0;
  if (start < 0) throw new Error(`No step ${fromStep}; its steps are ${recipe.steps.map((s) => s.id).join(', ')}`);
  for (const [i, step] of recipe.steps.entries()) {
    if (i < start) continue;
    const target = 'target' in step ? fill(step.target, values) : undefined;
    const stop = (reason: string) => ({ result: { status: 'stopped', stepId: step.id, note: step.note, kind: step.kind, target, nextStepId: recipe.steps[i + 1]?.id, reason } satisfies SetupResult, captured });
    try {
      if (step.kind === 'goto') await ops.goto(step.url);
      if (!isOn(ops.url(), recipe.domains)) return stop(`The page left ${recipe.domains.join(', ')} (now ${hostOf(ops.url())}): the user may need to sign in there first`);
      if (step.kind === 'click') await ops.click(target!);
      if (step.kind === 'choose') {
        const options = await ops.options(target!);
        const value = values[step.param] ?? (options.length === 1 ? options[0] : undefined);
        if (!value || !options.includes(value)) {
          await ops.close();
          return { result: { status: 'needs', param: step.param, question: recipe.params[step.param]?.question ?? `Which ${step.param}?`, options } satisfies SetupResult, captured };
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
  return { result: { status: 'done', captured: Object.keys(captured) as CaptureKind[] } satisfies SetupResult, captured };
}

function fill(target: SetupTarget, params: Record<string, string>): SetupTarget {
  return { ...target, name: fillName(target.name, params), ...(target.within && { within: fill(target.within, params) }) };
}

function isOn(url: string, domains: string[]) {
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname : url);
