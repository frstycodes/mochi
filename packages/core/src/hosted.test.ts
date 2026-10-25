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
  'Core answers git, fs and projects itself, with no main connected, and pushes the change',
  () =>
    Effect.gen(function* () {
      const repo = realpathSync(
        mkdtempSync(path.join(tmpdir(), 'mochi-repo-')),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(repo, { recursive: true, force: true })),
      );
      execFileSync('git', ['init', '-q', repo]);
      writeFileSync(path.join(repo, 'a.txt'), 'hello\n');

      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Capabilities.allScopes]]),
          origins: [],
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
    }),
);
