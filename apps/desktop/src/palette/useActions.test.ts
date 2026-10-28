import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { ACTIONS } from './actions.ts';
import type { ActionScope } from './when.ts';
import { onAnotherComputer } from './useActions.ts';

const byId = (id: string) => ACTIONS.find((a) => a.id === id)!;
const machine = { name: 'Studio' };

test('another computer’s thread: actions with a command stay, the rest say why instead of running here', () => {
  for (const id of ['thread-rename', 'thread-fork', 'thread-settle'])
    assert.equal(onAnotherComputer(byId(id), machine), byId(id), id);
  for (const id of ['thread-reveal', 'thread-replay', 'thread-schedule'])
    assert.equal(
      onAnotherComputer(byId(id), machine).disabledReason?.({} as ActionScope),
      'Do this on Studio itself for now',
      id,
    );
  assert.equal(
    onAnotherComputer(byId('layout-split'), machine),
    byId('layout-split'),
    'a split is this screen’s',
  );
});
