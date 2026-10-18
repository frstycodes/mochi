import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILT_IN_RECIPES, parseRecipe, parseRecipes, parseTarget, withOverrides, type SetupTarget } from '../../src/library/recipes.ts';
import { runRecipe, type RecipeOps } from './runRecipe.ts';

const slack = BUILT_IN_RECIPES.slack!;

/** A Slack apps page as `RecipeOps`: what it has, and a log of what the run did. */
function fakePage({ workspaces = ['Myself'], url = 'https://api.slack.com/apps', missing = [] as string[], copies = 'xoxe.xoxp-1-abc', apps = [] as string[] } = {}) {
  const log: string[] = [];
  let at = url;
  const has = (t: SetupTarget) => !missing.includes(t.name ?? '');
  const ops: RecipeOps = {
    url: () => at,
    goto: async (to) => void (log.push(`goto ${to}`), (at = url === to ? to : url)),
    click: async (t) => {
      if (!has(t)) throw new Error(`locator.click: Timeout 10000ms exceeded waiting for ${t.role} "${t.name}"`);
      log.push(`click ${t.name}`);
    },
    fill: async (t, value, submit) => void log.push(`fill ${t.name} ${value}${submit ? ' ⏎' : ''}`),
    options: async (t) => (log.push(`open ${t.name}`), workspaces),
    pick: async (o) => void log.push(`pick ${o}`),
    close: async () => void log.push('close'),
    waitForText: async (text) => void log.push(`wait ${text}`),
    isPresent: async (t) => apps.includes(t.name ?? ''),
    capture: async (t, isValid) => {
      log.push(`capture ${t.name}${t.within ? ` in ${t.within.name}` : ''}`);
      const value = t.name === 'Client ID' ? '1.2' : t.name === 'Copy client secret' ? 'a'.repeat(32) : copies;
      return isValid(value) ? value : '';
    },
  };
  return { ops, log };
}

test('runs the Slack recipe to the token, picking the only workspace and keeping the token out of the result', async () => {
  const { ops, log } = fakePage();
  const { result, captured } = await runRecipe(slack, {}, ops);
  assert.deepEqual(result, { status: 'done', captured: ['slackConfigToken'], params: { workspace: 'Myself' } });
  assert.equal(captured.slackConfigToken, 'xoxe.xoxp-1-abc');
  assert.deepEqual(log, ['goto https://api.slack.com/apps', 'click Generate Token', 'open Select a team', 'pick Myself', 'click Generate', 'capture Copy access token in Myself']);
});

test('asks which workspace when there are several, then runs with the answer', async () => {
  const several = fakePage({ workspaces: ['Acme', 'Myself'] });
  const asked = await runRecipe(slack, {}, several.ops);
  assert.deepEqual(asked.result, { status: 'needs', stepId: 'workspace', param: 'workspace', question: 'Which Slack workspace should Mochi connect to?', options: ['Acme', 'Myself'] });
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
  assert.match(left.result.status === 'stopped' ? left.result.reason : '', /left api\.slack\.com, app\.slack\.com \(now slack\.com\).*sign in/);
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

test("a recipe from the repo passes only with known kinds and this build's domains; a bad one is left out, not the rest", () => {
  const good = structuredClone(slack);
  assert.deepEqual(parseRecipe('slack', good), slack);
  const elsewhere = { ...structuredClone(slack), domains: ['evil.example'] };
  assert.throws(() => parseRecipe('slack', elsewhere), /domains must be within api\.slack\.com/);
  const leaves = structuredClone(slack);
  leaves.steps[0] = { id: 'open', kind: 'goto', url: 'https://evil.example/apps', note: 'x' };
  assert.throws(() => parseRecipe('slack', leaves), /must go to https on api\.slack\.com/);
  assert.throws(() => parseRecipe('slack', { ...structuredClone(slack), steps: [{ id: 'run', kind: 'eval', note: 'x' }] }), /unknown kind/);
  assert.throws(() => parseRecipe('notion', good), /no allowed domains/);
  assert.deepEqual(Object.keys(parseRecipes({ slack: good, notion: good, bad: 1 })), ['slack']);
});

test("reuses a Mochi app already in the workspace: opens it and captures its credentials instead of ending for a new one", async () => {
  const { ops, log } = fakePage({ apps: ['Mochi Myself'] });
  const { result, captured } = await runRecipe(slack, {}, ops);
  assert.deepEqual(result, { status: 'done', captured: ['slackConfigToken', 'slackClientId', 'slackClientSecret'], params: { workspace: 'Myself' } });
  assert.deepEqual(log.slice(-3), ['click Mochi', 'capture Client ID', 'capture Copy client secret']);
  assert.equal(captured.slackClientId, '1.2');
});

test('fills generated params, asks for a decision only the user makes, fills fields and waits for text', async () => {
  const recipe = parseRecipe('google-workspace', {
    version: 1,
    domains: ['console.cloud.google.com'],
    params: { suffix: { generate: 'suffix' }, agree: { question: 'Agree to the policy?', options: ['I agree'] } },
    steps: [
      { id: 'open', kind: 'goto', url: 'https://console.cloud.google.com/projectcreate', note: 'x' },
      { id: 'id', kind: 'fill', target: { role: 'textbox', name: 'Project ID' }, value: 'mochi-{suffix}', note: 'x' },
      { id: 'consent', kind: 'ask', param: 'agree', note: 'x' },
      { id: 'enabled', kind: 'wait', text: 'You have successfully enabled', note: 'x' },
      { id: 'email', kind: 'fill', target: { role: 'textbox', name: 'Text field for emails' }, value: 'me@x.com', submit: true, note: 'x' },
    ],
  });
  const page = fakePage({ url: 'https://console.cloud.google.com/projectcreate' });
  const asked = await runRecipe(recipe, {}, page.ops);
  assert.equal(asked.result.status === 'needs' && asked.result.options.join(), 'I agree');
  assert.match(page.log[1], /^fill Project ID mochi-\d{6}$/);
  const suffix = asked.params.suffix;
  const done = await runRecipe(recipe, { suffix, agree: 'I agree' }, fakePage({ url: 'https://console.cloud.google.com/projectcreate' }).ops, 'consent');
  assert.deepEqual(done.result, { status: 'done', captured: [], params: { suffix, agree: 'I agree' } });
});

test('a recipe may only jump forward and use params it declares', () => {
  const base = { version: 1, domains: ['api.slack.com'], params: { workspace: {} } };
  assert.throws(() => parseRecipe('slack', { ...base, steps: [{ id: 'a', kind: 'end', note: 'x' }, { id: 'b', kind: 'jumpIfPresent', target: { role: 'row' }, to: 'a', note: 'x' }] }), /jumps to a later step/);
  assert.throws(() => parseRecipe('slack', { ...base, steps: [{ id: 'a', kind: 'click', target: { role: 'row', name: '{team}' }, note: 'x' }] }), /undeclared param team/);
  assert.throws(() => parseRecipe('slack', { ...base, steps: [{ id: 'a', kind: 'goto', url: 'https://api.slack.com/{team}', note: 'x' }] }), /undeclared param team/);
});

test("Google's recipe runs to the Desktop client, stopping once for the user's agreement to the policy", async () => {
  const google = BUILT_IN_RECIPES['google-workspace']!;
  const log: string[] = [];
  const ops: RecipeOps = {
    url: () => 'https://console.cloud.google.com/auth',
    goto: async (to) => void log.push(`goto ${to}`),
    click: async (t) => void log.push(`click ${t.name ?? t.role}`),
    fill: async (t, value) => void log.push(`fill ${t.name} ${value}`),
    options: async () => ['me@x.com'],
    pick: async (o) => void log.push(`pick ${o}`),
    close: async () => {},
    waitForText: async (text) => void log.push(`wait ${text}`),
    isPresent: async () => false,
    capture: async (t, isValid) => [`${t.name}`.includes('GOCSPX') ? 'GOCSPX-abc' : '1-x.apps.googleusercontent.com'].find(isValid) ?? '',
  };
  const asked = await runRecipe(google, {}, ops);
  assert.equal(asked.result.status === 'needs' && asked.result.stepId, 'policy');
  assert.equal(asked.params.email, 'me@x.com', 'the only support email');
  const suffix = asked.params.suffix;
  assert.ok(log.includes(`fill Project ID mochi-${suffix}`) && log.includes(`wait You are going to make changes to project mochi-${suffix}`));
  const done = await runRecipe(google, { ...asked.params, agree: 'I agree' }, ops, 'policy');
  assert.deepEqual(done.result.status === 'done' && done.result.captured, ['googleClientId', 'googleClientSecret']);
  assert.ok(log.includes('fill Text field for emails me@x.com') && log.includes(`goto https://console.cloud.google.com/auth/clients/create?project=mochi-${suffix}&authuser=0`));
});

test('an org that blocks new projects stops the run at once with what to do, and the owner and sign-in account fill in', async () => {
  const google = BUILT_IN_RECIPES['google-workspace']!;
  const log: string[] = [];
  const ops: RecipeOps = {
    url: () => 'https://console.cloud.google.com/apis',
    goto: async (to) => void log.push(`goto ${to}`),
    click: async () => {},
    fill: async (t, value) => void log.push(`fill ${t.name} ${value}`),
    options: async () => ['me@personal.com'],
    pick: async () => {},
    close: async () => {},
    waitForText: async () => {},
    isPresent: async (t) => t.name === 'Permission Required',
    capture: async () => '',
  };
  const blocked = await runRecipe(google, {}, ops);
  assert.equal(blocked.result.status === 'stopped' && blocked.result.stepId, 'org-blocked');
  assert.match(blocked.result.status === 'stopped' ? blocked.result.reason : '', /can't create Cloud projects.*params\.owner/);
  assert.match(log[0], /projectcreate\?authuser=0$/, 'the default account until one is named');
  log.length = 0;
  const owned = await runRecipe(google, { owner: 'me@personal.com', signInEmail: 'sam@acme.com', agree: 'I agree' }, { ...ops, isPresent: async () => false });
  assert.ok(log.every((l) => !l.startsWith('goto') || l.endsWith('authuser=me@personal.com')));
  assert.ok(log.includes('fill Text field for emails me@personal.com') && log.includes('fill Text field for emails sam@acme.com'), 'the owner is the contact, the Workspace account the test user');
  assert.equal(owned.result.status === 'stopped' && owned.result.stepId, 'client-id', 'runs to the capture (nothing to copy here)');
});
