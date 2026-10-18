import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { Locator, Page } from 'playwright-core';
import { parseTarget, SETUP_RECIPES, withOverrides, type RecipeOverrides, type SetupTarget } from '../../src/library/recipes.ts';
import type { RecipeOps } from './runRecipe.ts';
import { copiedBy } from '../browser/views.ts';

const STEP_TIMEOUT_MS = 10_000;

/** Steps on the agent's tab: elements by role and name, the first match. */
export function playwrightOps(page: Page): RecipeOps {
  const find = (t: SetupTarget): Locator => (t.within ? find(t.within) : page).getByRole(t.role as Parameters<Page['getByRole']>[0], { name: t.name, exact: t.exact }).first();
  let select: Locator | null = null;
  return {
    url: () => page.url(),
    goto: async (url) => void (await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })),
    click: (t) => find(t).click({ timeout: STEP_TIMEOUT_MS }),
    options: async (t) => {
      const target = find(t);
      await target.waitFor({ timeout: STEP_TIMEOUT_MS });
      const isSelect = await target.evaluate((el) => el instanceof HTMLSelectElement);
      select = isSelect ? target : null;
      if (isSelect) return target.evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.label.trim()).filter(Boolean));
      await target.click({ timeout: STEP_TIMEOUT_MS });
      await page.getByRole('option').first().waitFor({ timeout: STEP_TIMEOUT_MS });
      return (await page.getByRole('option').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    },
    pick: async (option) => {
      if (select) await select.selectOption({ label: option });
      else await page.getByRole('option', { name: option, exact: true }).first().click({ timeout: STEP_TIMEOUT_MS });
    },
    close: () => page.keyboard.press('Escape'),
    capture: async (t, isValid) => {
      const target = find(t);
      await target.waitFor({ timeout: STEP_TIMEOUT_MS });
      const value = (await target.evaluate((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '')))).trim();
      if (isValid(value)) return value;
      const copied = await copiedBy(page, target);
      return isValid(copied) ? copied : '';
    },
  };
}

// {OVERRIDES}

const overridesFile = () => join(app.getPath('userData'), 'setup-overrides.json');

async function readOverrides(): Promise<Record<string, RecipeOverrides>> {
  return readFile(overridesFile(), 'utf8').then((text) => JSON.parse(text) as Record<string, RecipeOverrides>, () => ({}));
}

/** The shipped recipe with the user's overrides in place. */
export async function recipeFor(connector: string) {
  const recipe = SETUP_RECIPES[connector];
  if (!recipe) throw new Error(`Mochi has no setup recipe for ${connector}`);
  return withOverrides(recipe, (await readOverrides())[connector]);
}

/** Replaces one step's target in the user's overrides; overrides from an older recipe version are dropped. */
export async function overrideStep(connector: string, stepId: string, value: unknown) {
  const recipe = await recipeFor(connector);
  const step = recipe.steps.find((s) => s.id === stepId);
  if (!step || !('target' in step)) throw new Error(`${connector} has no step ${stepId} with an element; its steps are ${recipe.steps.filter((s) => 'target' in s).map((s) => s.id).join(', ')}`);
  const after = parseTarget(value);
  const all = await readOverrides();
  const current = all[connector]?.version === SETUP_RECIPES[connector]!.version ? all[connector]!.targets : {};
  all[connector] = { version: SETUP_RECIPES[connector]!.version, targets: { ...current, [stepId]: after } };
  const tmp = `${overridesFile()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2));
  await rename(tmp, overridesFile());
  return { before: step.target, after };
}
