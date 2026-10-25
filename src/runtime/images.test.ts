import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../host/types/agent.ts';
import { chatRows } from '../chat/rows.ts';
import { applyAgentEvent } from './apply.ts';
import type { State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { parseSaved, toSaved } from '../store/saved.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { createMapper } from '@mochi/core/agents/claude/map';
import { mapNotification, threadState } from '@mochi/core/agents/codex/map';
import type { SaveImage } from '@mochi/core/agents/images';

const THREAD = 'adm';
const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;
const apply = (events: AgentEvent[]) => events.reduce(applyAgentEvent, base());
const activity = (s: State) => s.threads.find((t) => t.id === THREAD)!.activity;

const saved: [string, string][] = [];
const saveImage: SaveImage = (mediaType, base64) => (
  saved.push([mediaType, base64]),
  `/data/images/${base64}.png`
);

const call = (id: string, name: string, input: Record<string, unknown>) =>
  ({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id, name, input }] },
  }) as unknown as SDKMessage;
const result = (id: string, content: unknown[]) =>
  ({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content }],
    },
  }) as unknown as SDKMessage;
const image = (data: string) => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data },
});

test('an image a Claude tool returns is saved and lands on its call as a path; a Read of an image saves nothing', () => {
  saved.length = 0;
  const { map } = createMapper(THREAD, '/repo', saveImage);
  const events = [
    call('shot', 'mcp__playwright__browser_take_screenshot', {}),
    result('shot', [
      { type: 'text', text: 'Took a screenshot' },
      image('AAAA'),
    ]),
    call('read', 'Read', { file_path: '/repo/logo.png' }),
    result('read', [image('BBBB')]),
  ].flatMap((m) => map(m));
  assert.deepEqual(saved, [['image/png', 'AAAA']]);
  const entries = activity(apply(events)).filter(
    (e) => e.toolId === 'shot' || e.toolId === 'read',
  );
  assert.deepEqual(entries[0].images, ['/data/images/AAAA.png']);
  assert.equal(entries[1].images, undefined);
});

test('a Codex image generation is one entry that runs, then holds the saved file, and gets its own transcript row', () => {
  saved.length = 0;
  const s = threadState(THREAD, '/repo', { saveImage });
  const item = {
    type: 'imageGeneration',
    id: 'ig1',
    status: 'in_progress',
    revisedPrompt: 'A mochi sticker',
    result: '',
    failure: null,
  };
  const started = apply(mapNotification('item/started', { item }, s));
  assert.deepEqual(activity(started).at(-1)!.generated, {
    status: 'running',
    prompt: 'A mochi sticker',
  });

  const ended = mapNotification(
    'item/completed',
    { item: { ...item, status: 'completed', result: 'CCCC' } },
    s,
  ).reduce(applyAgentEvent, started);
  const entry = activity(ended).at(-1)!;
  assert.deepEqual(entry.generated, {
    status: 'done',
    prompt: 'A mochi sticker',
    src: '/data/images/CCCC.png',
  });
  assert.equal(chatRows(activity(ended)).at(-1)!.kind, 'image');
});

test('a Codex generation that hit its limit fails with the reason; an image view reads as a Read of that file', () => {
  const s = threadState(THREAD, '/repo', { saveImage });
  const [failed] = mapNotification(
    'item/completed',
    {
      item: {
        type: 'imageGeneration',
        id: 'ig2',
        status: 'failed',
        revisedPrompt: null,
        result: '',
        failure: {
          type: 'usageLimitExceeded',
          limitId: 'images',
          resetsAt: null,
        },
      },
    },
    s,
  );
  assert.deepEqual(failed.type === 'tool' && failed.generated, {
    status: 'failed',
    error: 'Image generation limit reached.',
  });
  const [view] = mapNotification(
    'item/completed',
    { item: { type: 'imageView', id: 'iv1', path: '/repo/shots/home.png' } },
    s,
  );
  assert.equal(view.type === 'tool' && view.text, 'Read shots/home.png');
});

test('images survive a reload as paths; a generation that was still running comes back stopped', () => {
  let s = threadsReducer(
    {
      ...initialThreads(null, true),
      ...initialQueue(null, true),
      spaceId: 'personal',
      views: {},
    } as unknown as State,
    {
      type: 'create',
      title: 'draw a mascot',
      provider: 'codex',
      project: '/Users/me/dev/app',
      isLive: true,
    },
  );
  const id = s.threads.at(-1)!.id;
  const shot: AgentEvent = {
    threadId: id,
    type: 'tool',
    id: 'shot',
    phase: 'start',
    text: 'Mcp playwright: browser_take_screenshot',
  };
  const draw: AgentEvent = {
    threadId: id,
    type: 'tool',
    id: 'draw',
    phase: 'start',
    text: 'Generate image',
    generated: { status: 'running', prompt: 'A mochi sticker' },
  };
  s = [
    shot,
    { ...shot, phase: 'end', images: ['/data/images/AAAA.png'] } as AgentEvent,
    draw,
  ].reduce(applyAgentEvent, s);

  const back = parseSaved(JSON.stringify(toSaved(s)))!;
  const restored = back.threads.find((t) => t.id === id)!.activity;
  assert.deepEqual(restored.find((e) => e.toolId === 'shot')!.images, [
    '/data/images/AAAA.png',
  ]);
  assert.deepEqual(restored.find((e) => e.toolId === 'draw')!.generated, {
    status: 'failed',
    prompt: 'A mochi sticker',
    error: 'Stopped when Mochi quit',
  });
});
