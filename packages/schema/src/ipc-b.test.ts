import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { Schema } from 'effect';
import { projectsRpc } from './ipc/projects.ts';
import { remoteRpc } from './ipc/remote.ts';
import { scheduleRpc } from './ipc/schedule.ts';
import { simRpc } from './ipc/sim.ts';
import { themesRpc } from './ipc/themes.ts';
import { usageRpc } from './ipc/usage.ts';
import { windowsRpc } from './ipc/windows.ts';

type Entry = { input?: Schema.Top; output?: Schema.Top; event?: Schema.Top };
const tables: Record<string, Record<string, Entry>> = { projects: projectsRpc, remote: remoteRpc, schedule: scheduleRpc, sim: simRpc, themes: themesRpc, usage: usageRpc, windows: windowsRpc };
const { calls, rejected }: { calls: Record<string, Record<string, unknown>[]>; rejected: Record<string, unknown[][]> } = JSON.parse(readFileSync(new URL('../fixtures/ipc-b.json', import.meta.url), 'utf8'));

const entry = (key: string) => {
  const [ns, method] = key.split('.');
  const found = tables[ns]?.[method];
  assert.ok(found, `${key} is in its namespace's table`);
  return found;
};

const roundTrip = (schema: Schema.Top, value: unknown, label: string) => {
  const decoded = Schema.decodeUnknownSync(schema as Schema.Codec<unknown, unknown>)(value);
  assert.deepEqual(decoded, value, `${label} decodes as recorded`);
  assert.deepEqual(Schema.encodeSync(schema as Schema.Codec<unknown, unknown>)(decoded), value, `${label} encodes back`);
};

test('recorded calls of projects, remote, schedule, sim, themes, usage and windows round-trip', () => {
  for (const [key, list] of Object.entries(calls))
    for (const call of list) {
      const e = entry(key);
      if ('input' in call) roundTrip(e.input!, call.input, `${key} input`);
      if ('output' in call) roundTrip(e.output!, call.output, `${key} output`);
      if ('event' in call) roundTrip(e.event!, call.event, `${key} event`);
    }
});

test('every method of these namespaces has a recording', () => {
  const missing = Object.entries(tables).flatMap(([ns, table]) => Object.keys(table).map((m) => `${ns}.${m}`)).filter((key) => !calls[key]);
  // A frame carries bytes JSON can't hold: its own test below.
  assert.deepEqual(missing, ['sim.onFrame']);
});

test('inputs main refuses today are refused', () => {
  for (const [key, inputs] of Object.entries(rejected))
    for (const input of inputs) assert.throws(() => Schema.decodeUnknownSync(entry(key).input as Schema.Codec<unknown, unknown>)(input), `${key} ${JSON.stringify(input).slice(0, 120)}`);
});

test('a simulator frame carries its bytes', () => {
  const frame = { udid: 'A1B2C3D4-0000-4000-8000-000000000001', data: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' };
  assert.deepEqual(Schema.decodeUnknownSync(simRpc.onFrame.event)(frame), frame);
  assert.throws(() => Schema.decodeUnknownSync(simRpc.onFrame.event)({ ...frame, data: [1, 2, 3] }));
});

test('optional IPC fields accept undefined, as structured clone sends them', () => {
  const input = ['personal', { url: 'https://x/y.git' }, { parentDir: '/a', opId: 'o', githubUser: undefined }];
  assert.deepEqual(Schema.decodeUnknownSync(projectsRpc.clone.input)(input), input);
});
