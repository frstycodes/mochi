import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Context, Effect, Fiber, Layer, Option, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from './client.ts';
import { makeHostCaller } from './hostClient.ts';
import { layerCore } from './server.ts';

const TOKEN = 'local-token';

it.live(
  'Core answers the moved host namespaces itself, with no main connected, and pushes changes',
  () =>
    Effect.gen(function* () {
      const repo = realpathSync(
        mkdtempSync(path.join(tmpdir(), 'mochi-repo-')),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(repo, { recursive: true, force: true })),
      );
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-data-'));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(userData, { recursive: true, force: true })),
      );
      execFileSync('git', ['init', '-q', repo]);
      writeFileSync(path.join(repo, 'a.txt'), 'hello\n');

      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Capabilities.allScopes]]),
          origins: [],
          userData,
        }),
      );
      const { port } = Context.get(context, HttpServer.HttpServer).address as {
        port: number;
      };
      const client = yield* makeCoreClient(coreUrl(port, TOKEN));
      const call = makeHostCaller(client);
      const changed = yield* client.agentPush().pipe(
        Stream.filter((item) => item.channel === 'projects:onChange'),
        Stream.runHead,
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* client.ping();

      const project = (yield* Effect.promise(() =>
        call('projects.addFolder', ['space', repo]),
      )) as { path: string };
      assert.equal(project.path, repo);
      assert.deepEqual(
        (
          (yield* Effect.promise(() =>
            call('projects.list', ['space']),
          )) as Array<{ path: string }>
        ).map((p) => p.path),
        [repo],
      );
      assert.deepEqual(
        Option.map(yield* Fiber.join(changed), (item) => item.payload),
        Option.some('space'),
      );
      assert.deepEqual(yield* Effect.promise(() => call('fs.list', [repo])), [
        'a.txt',
      ]);
      const status = (yield* Effect.promise(() =>
        call('git.status', [repo]),
      )) as { files: Array<{ path: string }> };
      assert.deepEqual(
        status.files.map((f) => f.path),
        ['a.txt'],
      );

      yield* Effect.promise(() =>
        call('data.appendReplay', ['t1', '{"t":1}\n']),
      );
      assert.equal(
        yield* Effect.promise(() => call('data.loadReplay', ['t1'])),
        '{"t":1}\n',
      );
      assert.deepEqual(
        yield* Effect.promise(() => call('themes.list', [])),
        [],
      );
      assert.equal(
        typeof (yield* Effect.promise(() => call('ports.allocate', ['t1']))),
        'number',
      );

      let seen = '';
      const output = yield* client.agentPush().pipe(
        Stream.filter((item) => item.channel.startsWith('pty:')),
        Stream.map((item) => JSON.stringify(item.payload)),
        Stream.tap((data) => Effect.sync(() => (seen += data))),
        Stream.takeUntil(() => withoutEscapes(seen).includes('mochi-pty-ok')),
        Stream.runDrain,
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* client.ping();
      const { id } = (yield* Effect.promise(() =>
        call('pty.spawn', [{ cwd: repo, cols: 80, rows: 24, threadId: 't1' }]),
      )) as { id: string };
      yield* Effect.promise(() =>
        call('pty.write', [id, 'echo mochi-pty-ok\r']),
      );
      // The shell's echo of the line is enough: it came back through the pty and Core's push.
      const isDone = yield* Fiber.join(output).pipe(
        Effect.timeoutOption('20 seconds'),
      );
      assert.ok(Option.isSome(isDone), `pty pushed: ${seen.slice(-800)}`);
      // Kill it and wait for its exit before the scope closes: a ConPTY torn down mid-kill crashes the worker on Windows.
      const exited = yield* client.agentPush().pipe(
        Stream.filter((item) => item.channel === 'pty:onExit'),
        Stream.runHead,
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* client.ping();
      yield* Effect.promise(() => call('pty.kill', [id]));
      assert.ok(Option.isSome(yield* Fiber.join(exited)));
    }),
);

it.live(
  "the git diff watch reads through Core's own git, with no main connected and no commit yet",
  () =>
    Effect.gen(function* () {
      const repo = realpathSync(
        mkdtempSync(path.join(tmpdir(), 'mochi-repo-')),
      );
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-data-'));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          rmSync(repo, { recursive: true, force: true });
          rmSync(userData, { recursive: true, force: true });
        }),
      );
      execFileSync('git', ['init', '-q', '-b', 'main', repo]);
      writeFileSync(path.join(repo, 'a.txt'), 'hello\n');

      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Capabilities.allScopes]]),
          origins: [],
          userData,
        }),
      );
      const { port } = Context.get(context, HttpServer.HttpServer).address as {
        port: number;
      };
      const client = yield* makeCoreClient(coreUrl(port, TOKEN));
      const first = Option.getOrThrow(
        yield* client
          .watch({ key: { _tag: 'gitDiff', cwd: repo, scope: 'branch' } })
          .pipe(Stream.runHead, Effect.timeout('20 seconds')),
      );
      assert.ok(first._tag === 'gitDiff', JSON.stringify(first));
      assert.deepEqual(
        first.diff.files.map((f) => f.path),
        ['a.txt'],
      );
    }),
);

/** Terminal output without its control sequences: shells colour and redraw the line they echo (PSReadLine, zsh highlighting). */
const withoutEscapes = (text: string) =>
  // oxlint-disable-next-line no-control-regex -- matching escape sequences is the point.
  text.replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g, '');
