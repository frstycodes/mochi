import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registry } from './index.ts';
import { manifest } from './types/index.ts';

test('every manifest namespace has a web mock and a desktop impl', () => {
  assert.deepEqual(Object.keys(registry).sort(), Object.keys(manifest).sort());
  for (const [ns, methods] of Object.entries(manifest)) {
    const { web, desktop } = registry[ns as keyof typeof registry];
    assert.equal(typeof desktop, 'function', `${ns}: desktop impl`);
    for (const method of Object.keys(methods))
      assert.equal(typeof Reflect.get(web, method), 'function', `${ns}.${method}: web mock`);
  }
});

test('web mocks return data shaped like the desktop host', async () => {
  assert.ok((await registry.ports.web.list(['.'])).every((r) => 'ports' in r && r.ports.every((p) => Number.isInteger(p.port))));
  assert.ok((await registry.git.web.status('/repo')).branch);
  const seen: string[] = [];
  const off = registry.pty.web.onData(({ data }) => seen.push(data));
  await registry.pty.web.write('pty-1', 'x');
  off();
  await registry.pty.web.write('pty-1', 'y');
  assert.deepEqual(seen, ['x']);
});
