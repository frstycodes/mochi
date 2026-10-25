import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { POLICIES } from '@mochi/core/agents/codex/adapter';
import { permissionOptions } from '@mochi/core/agents/claude/map';
import { ACCESS, accessOf } from './access.ts';
import { agentOptions } from './agentOptions.ts';
import { parsePrefs } from '../settings/prefs.ts';

const sent = (
  provider: 'claude' | 'codex',
  access: (typeof ACCESS)[number],
) => {
  const mode = agentOptions(
    { model: '', effort: 'high', speed: '', access },
    provider,
    'personal',
  ).permissionMode;
  if (provider === 'codex') return { mode, ...POLICIES[mode] };
  const { allowedTools, ...rest } = permissionOptions(
    mode as Parameters<typeof permissionOptions>[0],
  );
  return { ...rest, allowedTools };
};

test('each mode sends each harness these options', () => {
  assert.deepEqual(
    Object.fromEntries(ACCESS.map((a) => [a, sent('claude', a)])),
    {
      Manual: {
        permissionMode: 'default',
        allowDangerouslySkipPermissions: false,
        allowedTools: ['WebSearch'],
      },
      Auto: {
        permissionMode: 'auto',
        allowDangerouslySkipPermissions: false,
        allowedTools: ['WebSearch', 'WebFetch'],
      },
      'Full access': {
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        allowedTools: [],
      },
      Plan: {
        permissionMode: 'plan',
        allowDangerouslySkipPermissions: false,
        allowedTools: ['WebSearch'],
      },
    },
  );
  assert.deepEqual(
    Object.fromEntries(ACCESS.map((a) => [a, sent('codex', a)])),
    {
      Manual: {
        mode: 'default',
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
      },
      Auto: {
        mode: 'auto',
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        approvalsReviewer: 'auto_review',
      },
      'Full access': {
        mode: 'bypassPermissions',
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      },
      // Codex has no Plan mode: a thread carried over runs as Manual, never looser.
      Plan: {
        mode: 'default',
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
      },
    },
  );
});

test('stored modes from before the rename read as the new names', () => {
  assert.equal(accessOf('Ask first'), 'Manual');
  assert.equal(accessOf('Auto edit'), 'Auto');
  assert.equal(accessOf('Full access'), 'Full access');
  assert.equal(accessOf('Plan'), 'Plan');
  assert.equal(accessOf('nonsense'), 'Auto');
  assert.equal(
    parsePrefs(JSON.stringify({ permissions: 'Ask first' })).permissions,
    'Manual',
  );
  assert.equal(
    parsePrefs(JSON.stringify({ permissions: 'Auto edit' })).permissions,
    'Auto',
  );
  assert.equal(
    parsePrefs(JSON.stringify({ permissions: 'Full access' })).permissions,
    'Full access',
  );
  assert.equal(
    parsePrefs(JSON.stringify({ permissions: 'Plan' })).permissions,
    'Auto',
  );
});
