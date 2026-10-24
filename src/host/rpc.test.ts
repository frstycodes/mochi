import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manifest } from './types/index.ts';
import { hostTags } from '@mochi/schema';

test('every invoke method in the host manifest has an RPC, and nothing else does', () => {
  const invokes = Object.entries(manifest).flatMap(([namespace, methods]) =>
    Object.entries(methods)
      .filter(([, kind]) => kind === 'invoke')
      .map(([method]) => `${namespace}.${method}`),
  );
  assert.deepEqual([...hostTags].sort(), invokes.sort());
});
