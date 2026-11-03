import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { FollowedMachine } from './host/types/remote.ts';
import {
  cloneSource,
  copyBlocker,
  isAway,
  queuedClone,
  syncNeed,
} from './copyActions.ts';
import type { ProjectWithCopies } from './projectCopies.ts';
import type { Computer } from './remote/computers.ts';

const pc = (status: FollowedMachine['status'], scopes: string[]): Computer => ({
  id: 'pc',
  name: 'Windows PC',
  kind: 'windows',
  machine: { id: 'pc', name: 'Windows PC', status, scopes } as FollowedMachine,
});

test('an offline computer is sent to by mail; only a pairing without manage stops a clone or link', () => {
  const here: Computer = { id: null, name: 'Mac', kind: 'mac' };
  assert.equal(isAway(here), false);
  assert.equal(isAway(pc('offline', ['manage'])), true);
  assert.equal(isAway(pc('online', ['manage'])), false);
  assert.equal(copyBlocker(here), undefined);
  assert.equal(copyBlocker(pc('offline', ['read', 'manage'])), undefined);
  assert.equal(copyBlocker(pc('connecting', [])), undefined);
  assert.equal(
    copyBlocker(pc('online', ['read'])),
    'Windows PC doesn’t let this computer change its projects',
  );
});

test('a queued clone is found by its computer and the project’s remote', () => {
  const project = {
    key: 'k',
    name: 'mochi',
    origin: 'github.com/frstycodes/mochi',
    icon: null,
    copies: [],
  } satisfies ProjectWithCopies;
  const mail = {
    id: 'm1',
    machineId: 'pc',
    command: {
      type: 'clone-project',
      source: { github: 'frstycodes/mochi' },
    },
    at: 0,
    expiresAt: 1,
  } as const;
  const computer = pc('offline', ['manage']);
  assert.equal(queuedClone([mail], project, computer), mail);
  assert.equal(
    queuedClone([mail], { ...project, origin: 'github.com/a/b' }, computer),
    undefined,
  );
  assert.equal(
    queuedClone([mail], project, { ...computer, id: 'box' }),
    undefined,
  );
  assert.equal(
    queuedClone([mail], { ...project, origin: null }, computer),
    undefined,
  );
});

test('a copy needs Push for commits of its own, Pull when only behind, nothing otherwise', () => {
  const at = (ahead: number, behind: number) => ({
    branch: 'main',
    changed: 0,
    upstream: { ahead, behind },
  });
  assert.equal(syncNeed(at(2, 0)), 'push');
  assert.equal(syncNeed(at(2, 3)), 'push');
  assert.equal(syncNeed(at(0, 3)), 'pull');
  assert.equal(syncNeed(at(0, 0)), null);
  assert.equal(syncNeed({ branch: 'wip', changed: 0 }), null);
  assert.equal(syncNeed(null), null);
});

test('a GitHub remote clones as owner/repo with gh, any other host over HTTPS', () => {
  assert.deepEqual(cloneSource('github.com/frstycodes/mochi'), {
    github: 'frstycodes/mochi',
  });
  assert.deepEqual(cloneSource('gitlab.com/me/repo'), {
    url: 'https://gitlab.com/me/repo.git',
  });
});
