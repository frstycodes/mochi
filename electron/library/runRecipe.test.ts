import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTarget, SETUP_RECIPES, withOverrides, type SetupTarget } from '../../src/library/recipes.ts';
import { runRecipe, type RecipeOps } from './runRecipe.ts';

const slack = SETUP_RECIPES.slack!;

/** A Slack apps page as `RecipeOps`: what it has, and a log of what the run did. */
function fakePage({ workspaces = ['Myself'], url = 'https://api.slack.com/apps', missing = [] as string[], copies = 'xoxe.xoxp-1-abc' } = {}) {
  const log: string[] = [];
  let at = url;
  const has = (t: SetupTarget) => !missing.includes(t.name);
  const ops: RecipeOps = {
    url: () => at,
    goto: async (to) => void (log.push(`goto ${to}`), (at = url === to ? to : url)),
    click: async (t) => {
      if (!has(t)) throw new Error(`locator.click: Timeout 10000ms exceeded waiting for ${t.role} "${t.name}"`);
      log.push(`click ${t.name}`);
    },
    options: async (t) => (log.push(`open ${t.name}`), workspaces),
    pick: async (o) => void log.push(`pick ${o}`),
    close: async () => void log.push('close'),
    capture: async (t, isValid) => (log.push(`capture ${t.name} in ${t.within?.name}`), isValid(copies) ? copies : ''),
  };
  return { ops, log };
}

test('runs the Slack recipe to the token, picking the only workspace and keeping the token out of the result', async () => {
  const { ops, log } = fakePage();
  const { result, captured } = await runRecipe(slack, {}, ops);
  assert.deepEqual(result, { status: 'done', captured: ['slackConfigToken'] });
  assert.equal(captured.slackConfigToken, 'xoxe.xoxp-1-abc');
  assert.deepEqual(log, ['goto https://api.slack.com/apps', 'click Generate Token', 'open Select a team', 'pick Myself', 'click Generate', 'capture Copy access token in Myself']);
});

test('asks which workspace when there are several, then runs with the answer', async () => {
  const several = fakePage({ workspaces: ['Acme', 'Myself'] });
  const asked = await runRecipe(slack, {}, several.ops);
  assert.deepEqual(asked.result, { status: 'needs', param: 'workspace', question: 'Which Slack workspace should Mochi connect to?', options: ['Acme', 'Myself'] });
  assert.equal(several.log.at(-1), 'close');
  const { ops, log } = fakePage({ workspaces: ['Acme', 'Myself'] });
  assert.equal((await runRecipe(slack, { workspace: 'Acme' }, ops)).result.status, 'done');
  assert.ok(log.includes('pick Acme') && log.includes('capture Copy access token in Acme'));
});

test('stops at a step whose element is gone, naming it and the next step, and resumes from a step', async () => {
  const { ops } = fakePage({ missing: ['Generate Token'] });
  const { result } = await runRecipe(slack, {}, ops);
  assert.equal(result.status, 'stopped');
  assert.deepEqual(result.status === 'stopped' && [result.stepId, result.nextStepId, result.kind], ['generate', 'workspace', 'click']);
  const resumed = fakePage();
  assert.equal((await runRecipe(slack, {}, resumed.ops, 'workspace')).result.status, 'done');
  assert.equal(resumed.log[0], 'open Select a team');
  await assert.rejects(runRecipe(slack, {}, resumed.ops, 'nope'), /No step nope/);
});

test('stops when the page leaves the recipe\'s domains, and when the capture holds no token', async () => {
  const signIn = fakePage({ url: 'https://slack.com/signin?redir=%2Fapps' });
  const left = await runRecipe(slack, {}, signIn.ops);
  assert.equal(left.result.status === 'stopped' && left.result.stepId, 'open');
  assert.match(left.result.status === 'stopped' ? left.result.reason : '', /left api\.slack\.com \(now slack\.com\).*sign in/);
  const empty = await runRecipe(slack, {}, fakePage({ copies: 'Copied!' }).ops);
  assert.equal(empty.result.status === 'stopped' && empty.result.stepId, 'copy');
  assert.deepEqual(empty.captured, {});
});

test("overrides replace only targets, and only for the recipe version they were made for", () => {
  const target = { role: 'button', name: 'Generate new token', exact: true };
  const fixed = withOverrides(slack, { version: slack.version, targets: { generate: target } });
  assert.deepEqual(fixed.steps.find((s) => s.id === 'generate'), { ...slack.steps[1], target });
  assert.equal(withOverrides(slack, { version: slack.version + 1, targets: { generate: target } }), slack);
  assert.deepEqual(fixed.domains, slack.domains);
});

test('takes a target only as role and name, one level deep', () => {
  assert.deepEqual(parseTarget({ role: 'button', name: ' Copy ', within: { role: 'row', name: '{workspace}' } }), { role: 'button', name: 'Copy', within: { role: 'row', name: '{workspace}' } });
  assert.throws(() => parseTarget({ role: 'Button!', name: 'x' }), /ARIA role/);
  assert.throws(() => parseTarget({ role: 'button', name: '' }), /accessible name/);
  assert.throws(() => parseTarget({ role: 'button', name: 'x', within: { role: 'row', name: 'y', within: { role: 'table', name: 'z' } } }), /one level/);
});
