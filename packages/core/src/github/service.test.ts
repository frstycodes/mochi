import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vite-plus/test';
import { Duration, Effect, Fiber, Layer, Schedule, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { Run } from '../run.ts';
import { GitHub, GithubTransport, pushCadence } from './service.ts';

/** Answers every aliased field of a query; each title names the request that produced it, so a value says which poll it came from. */
function fakeTransport() {
  const calls: { repo: string; query: string }[] = [];
  const layer = Layer.succeed(GithubTransport)({
    query: (_account, query, variables) =>
      Effect.sync(() => {
        calls.push({ repo: `${variables.owner}/${variables.name}`, query });
        const title = `call ${calls.length}`;
        const repository: Record<string, unknown> = {};
        const top: Record<string, unknown> = {};
        for (const [, alias, field] of query.matchAll(/(a\d+): (\w+)\((\w+)?/g)) {
          if (field === 'pullRequests' && query.includes(`${alias}: pullRequests(headRefName`))
            repository[alias] = { nodes: [{ number: 1, url: 'u', title, state: 'OPEN', isDraft: false, isCrossRepository: false, commits: { nodes: [] } }] };
          else if (field === 'pullRequests') repository[alias] = { nodes: [{ number: 2, title, headRefName: 'feat/x', headRefOid: 'h', labels: { nodes: [] }, commits: { nodes: [] } }] };
          else if (field === 'pullRequest') repository[alias] = { state: 'OPEN', url: title, headRefOid: 'h', mergeable: 'MERGEABLE', commits: { nodes: [] }, comments: { nodes: [] }, reviews: { nodes: [] }, reviewThreads: { nodes: [] } };
          else if (field === 'issueOrPullRequest') repository[alias] = { __typename: 'Issue', title, url: 'u', state: 'OPEN', stateReason: null, author: null };
          else if (field === 'search') top[alias] = { nodes: [] };
        }
        return { viewer: { login: 'me' }, repository, ...top };
      }),
  });
  return { calls, layer };
}

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-github-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'feat/x');
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

const callOf = (title: string) => Number(/call (\d+)/.exec(title)?.[1] ?? 0);

test('every surface on a repository shares one GraphQL request per poll', async () => {
  const cwd = gitRepo();
  const { calls, layer } = fakeTransport();
  const latest: number[] = [0, 0, 0, 0, 0];
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* GitHub;
        const surfaces = [
          Stream.map(github.watchPr(cwd), (v) => v.prs[0]!.title),
          Stream.map(github.watchCi(cwd, 7), (v) => v!.url),
          Stream.map(github.watchRef({ owner: 'o', repo: 'r', number: 3 }), (v) => v!.title),
          Stream.map(github.watchOpenPrs(cwd, false), (v) => v[0]!.title),
          // Another repository: its own request.
          Stream.map(github.watchRef({ owner: 'other', repo: 'x', number: 1 }), (v) => v!.title),
        ];
        const fibers = yield* Effect.forEach(surfaces, (stream, i) => Effect.forkChild(Stream.runForEach(stream, (title) => Effect.sync(() => (latest[i] = callOf(title))))));
        const until = (done: () => boolean) => Effect.sleep(10).pipe(Effect.repeat({ until: done, times: 500 }));

        yield* until(() => latest.every((n) => n > 0));
        const before = calls.length;
        yield* github.refresh({ cwd, isPush: true });
        yield* github.refresh({ ref: { owner: 'other', repo: 'x', number: 1 }, isPush: false });
        yield* until(() => latest.every((n) => n > before));

        const poll = calls.slice(before);
        assert.equal(poll.length, 2, `one request per repository, got ${poll.map((c) => c.repo).join(', ')}`);
        const own = poll.find((c) => c.repo === 'o/r')!;
        assert.equal([...own.query.matchAll(/\ba\d+: /g)].length, 4, 'one request carries PR, CI, ref and open-PR asks');
        assert.deepEqual(new Set(latest.slice(0, 4)).size, 1, 'every surface on o/r got its value from the same request');
        yield* Effect.forEach(fibers, Fiber.interrupt);
      }).pipe(Effect.provide(GitHub.layer.pipe(Layer.provide(Layer.mergeAll(layer, Run.layer.pipe(Layer.provide(NodeServices.layer))))))),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('after a push: every 30s for 10 minutes, then backing off to every 10 minutes', async () => {
  const delays = await Effect.runPromise(
    Effect.gen(function* () {
      const step = yield* Schedule.toStep(pushCadence);
      const out: number[] = [];
      let now = 0;
      for (let i = 0; i < 27; i++) {
        const [, delay] = yield* step(now, undefined);
        out.push(Duration.toSeconds(delay));
        now += Duration.toMillis(delay);
      }
      return out;
    }),
  );
  assert.deepEqual(delays.slice(0, 20), Array(20).fill(30));
  assert.deepEqual(delays.slice(-6), [60, 120, 240, 480, 600, 600]);
});
