import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { setAmbientPrefs } from '../../../src/store/context.ts';
import { actionOf, COMMAND_TYPE, domainFrom, project } from './index.ts';

/** Every module the file loads at runtime (type-only imports are erased), and the packages they name. */
function runtimeGraph(entry: string) {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (modules.has(file)) return;
    modules.add(file);
    for (const [, from] of readFileSync(file, 'utf8').matchAll(/^(?:import|export) (?!type )[^;]*?from '([^']+)';/gms)) {
      if (from!.startsWith('.')) visit(resolve(dirname(file), from!));
      else packages.add(from!);
    }
  };
  visit(entry);
  const root = resolve(import.meta.dirname, '../../..');
  return { modules: [...modules].map((m) => relative(root, m)), packages: [...packages].sort() };
}

test('the projection loads without the renderer: no React, no host, no browser storage in what it imports', () => {
  const { modules, packages } = runtimeGraph(join(import.meta.dirname, 'projection.ts'));
  assert.deepEqual(modules.filter((m) => /host\/(index|desktop|web)|uiStorage|settings\/prefs\.ts|chat\/pins\.ts|git\/worktrees|projects\.ts|demoData|\.tsx$/.test(m)), []);
  assert.ok(modules.some((m) => m.endsWith('src/runtime/apply.ts')), 'the walk reached the agent event fold');
  assert.deepEqual(packages, ['effect', 'zustand/vanilla/shallow']);
});

test('a fold reads prefs from the state, never from the window folding it, so Core and every window agree', () => {
  const create = { type: 'create', spaceId: 's', title: 'Add a chart', provider: 'claude', project: '/dev/app', isLive: true } as const;
  const base = domainFrom(null);
  const set = project(base, { type: 'context', context: { ...base.context, prefs: { ...base.context.prefs, branchPrefix: 'core/' } } });
  setAmbientPrefs(() => ({ ...base.context.prefs, branchPrefix: 'window/' }));
  const branch = project(set, create).threads.at(-1)!.repo!.branch;
  assert.match(branch, /^core\//);
});

test('logged events fold as actions: commands as sent, agent events with the time they were logged', () => {
  const event = { threadId: 't', type: 'message', text: 'hi' };
  assert.deepEqual(actionOf({ sequence: 1, type: 'agent.message', threadId: 't', payload: event, at: 5 }), { type: 'agent', event, ms: 5 });
  assert.deepEqual(actionOf({ sequence: 2, type: COMMAND_TYPE, threadId: 't', payload: { type: 'tick' } }), { type: 'tick' });
  assert.equal(actionOf({ sequence: 3, type: 'thread.saved', threadId: 't', payload: {} }), undefined);
});
