import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { cached } from '../cache.ts';
import { writeFileAtomic } from '@mochi/core/utility/atomicWrite';
import type { Locator, Page } from 'playwright-core';
import {
  BUILT_IN_RECIPES,
  parseRecipes,
  parseTarget,
  RECIPES_PATH,
  RECIPES_REPO,
  withOverrides,
  type RecipeOverrides,
  type SetupRecipe,
  type SetupTarget,
} from '../../src/library/recipes.ts';
import type { RecipeOps } from './runRecipe.ts';
import { copiedBy } from '../browser/views.ts';

const STEP_TIMEOUT_MS = 10_000;

/** Steps on the agent's tab: elements by role and name, the first match. */
export function playwrightOps(page: Page): RecipeOps {
  const all = (t: SetupTarget): Locator =>
    (t.within ? find(t.within) : page).getByRole(
      t.role as Parameters<Page['getByRole']>[0],
      t.name ? { name: t.name, exact: t.exact } : {},
    );
  const find = (t: SetupTarget) => all(t).first();
  let select: Locator | null = null;
  return {
    url: () => page.url(),
    goto: async (url) =>
      void (await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      })),
    click: (t) => find(t).click({ timeout: STEP_TIMEOUT_MS }),
    fill: async (t, value, submit) => {
      const target = find(t);
      await target.fill(value, { timeout: STEP_TIMEOUT_MS });
      if (submit) await target.press('Enter');
    },
    waitForText: (text, timeoutMs) =>
      page.getByText(text).first().waitFor({ timeout: timeoutMs }),
    isPresent: (t, timeoutMs) =>
      find(t)
        .waitFor({ timeout: timeoutMs })
        .then(
          () => true,
          () => false,
        ),
    texts: async (t, timeoutMs) => {
      const isShown = await find(t)
        .waitFor({ timeout: timeoutMs })
        .then(
          () => true,
          () => false,
        );
      return isShown ? all(t).allInnerTexts() : [];
    },
    options: async (t) => {
      const target = find(t);
      await target.waitFor({ timeout: STEP_TIMEOUT_MS });
      const isSelect = await target.evaluate(
        (el) => el instanceof HTMLSelectElement,
      );
      select = isSelect ? target : null;
      if (isSelect)
        return target.evaluate((el) =>
          [...(el as HTMLSelectElement).options]
            .map((o) => o.label.trim())
            .filter(Boolean),
        );
      await target.click({ timeout: STEP_TIMEOUT_MS });
      // A list can hold a disabled placeholder (Google's "No groups"): only the options one can pick count.
      const enabled = page.getByRole('option', { disabled: false });
      await enabled.first().waitFor({ timeout: STEP_TIMEOUT_MS });
      return (await enabled.allInnerTexts())
        .map((t) => t.trim())
        .filter(Boolean);
    },
    pick: async (option) => {
      if (select) await select.selectOption({ label: option });
      else
        await page
          .getByRole('option', { name: option, exact: true })
          .first()
          .click({ timeout: STEP_TIMEOUT_MS });
    },
    close: () => page.keyboard.press('Escape'),
    capture: async (t, isValid) => {
      const target = find(t);
      await target.waitFor({ timeout: STEP_TIMEOUT_MS });
      const value = (
        await target.evaluate((el) =>
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? el.value
            : (el.textContent ?? ''),
        )
      ).trim();
      if (isValid(value)) return value;
      const copied = await copiedBy(page, target);
      return isValid(copied) ? copied : '';
    },
  };
}

const overridesFile = () =>
  join(app.getPath('userData'), 'setup-overrides.json');

async function readOverrides(): Promise<Record<string, RecipeOverrides>> {
  return readFile(overridesFile(), 'utf8').then(
    (text) => JSON.parse(text) as Record<string, RecipeOverrides>,
    () => ({}),
  );
}

/** The connector's recipe (the repo's when it's at least as new as this build's) with the user's overrides in place. */
export async function recipeFor(connector: string) {
  return withOverrides(
    await baseRecipe(connector),
    (await readOverrides())[connector],
  );
}

async function baseRecipe(connector: string) {
  const built = BUILT_IN_RECIPES[connector];
  const fromRepo = (await repoRecipes())[connector];
  const recipe =
    fromRepo && (!built || fromRepo.version >= built.version)
      ? fromRepo
      : built;
  if (!recipe) throw new Error(`Mochi has no setup recipe for ${connector}`);
  return recipe;
}

// `MOCHI_RECIPES_URL` points dev runs and self-hosters at their own copy.
const RECIPES_URL =
  process.env.MOCHI_RECIPES_URL ??
  `https://raw.githubusercontent.com/${RECIPES_REPO}/main/${RECIPES_PATH}`;
const RECIPES_TTL = '6 hours';

/**
 * The repo's recipes, read at most every 6 hours, so a fix reaches every install without a release. Each one passes the
 * same checks as the built-in ones (`parseRecipe`: fixed step kinds, domains this build allows), and a bad one is left
 * out; unreachable, the built-in recipes run.
 */
async function repoRecipes(): Promise<Partial<Record<string, SetupRecipe>>> {
  return cached('recipes', RECIPES_TTL, fetchRecipes);
}

function fetchRecipes() {
  return fetch(RECIPES_URL, { signal: AbortSignal.timeout(5000) })
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : {}))
    .then(
      (json): Partial<Record<string, SetupRecipe>> => parseRecipes(json),
      () => ({}),
    );
}

/** Replaces one step's target in the user's overrides; overrides from an older recipe version are dropped. */
export async function overrideStep(
  connector: string,
  stepId: string,
  value: unknown,
) {
  const recipe = await recipeFor(connector);
  const step = recipe.steps.find((s) => s.id === stepId);
  if (!step || !('target' in step))
    throw new Error(
      `${connector} has no step ${stepId} with an element; its steps are ${recipe.steps
        .filter((s) => 'target' in s)
        .map((s) => s.id)
        .join(', ')}`,
    );
  const after = parseTarget(value);
  const all = await readOverrides();
  const current =
    all[connector]?.version === recipe.version ? all[connector]!.targets : {};
  all[connector] = {
    version: recipe.version,
    targets: { ...current, [stepId]: after },
  };
  await writeFileAtomic(overridesFile(), JSON.stringify(all, null, 2));
  return { before: step.target, after };
}
