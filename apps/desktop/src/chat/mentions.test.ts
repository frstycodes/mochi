import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls } from '../runtime/live.ts';
import type { Thread } from '../model.ts';
import {
  mentionFor,
  mentionGroups,
  mentionOptions,
  mentionQuery,
  withoutQuery,
  withReferences,
  type Mention,
} from './mentions.ts';
import { slashItems, typedSkills } from './slash.ts';
import { fileMentionFor, worktreeMention } from './fileMentions.ts';

const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;
const calls = (s: State, action: Action) =>
  agentCalls(s, action, () => threadsReducer(s, action));

const other = {
  id: 'auth',
  title: 'Fix "login" redirect',
  status: 'running',
  repo: { project: 'web', branch: 'fix/login' },
  steps: [{ status: 'done' }, { status: 'running' }],
  activity: [
    { kind: 'message', who: 'you', text: 'Keep the return URL in state' },
    { kind: 'tool', who: 'claude', text: 'Edit src/auth.ts' },
    { kind: 'message', who: 'claude', text: `Done.\n${'x'.repeat(500)}` },
  ],
} as unknown as Thread;
const shot = { mediaType: 'image/jpeg', data: 'AAAA' } as const;

test('@ query is the last word after an @, never an email', () => {
  assert.equal(mentionQuery('@'), '');
  assert.equal(mentionQuery('look at @Saf'), 'Saf');
  assert.equal(mentionQuery('mail a@b.co'), null);
  assert.equal(mentionQuery('@Saf now'), null);
  assert.equal(withoutQuery('look at @Saf'), 'look at ');
});

test('a title with spaces matches its words typed run together', () => {
  const windows = [{ id: 'window:1', title: 'Greeting the user' }];
  assert.deepEqual(
    mentionOptions('greetingtheUSER', [other], windows, 'x').map((o) => o.kind),
    ['window'],
  );
  assert.deepEqual(
    mentionOptions('loginredirect', [other], [], 'x').map((o) => o.kind),
    [],
    'quotes are not spaces',
  );
});

test('options list other threads, then windows, by title', () => {
  const windows = [{ id: 'window:1', title: 'Safari — Docs' }];
  assert.deepEqual(
    mentionOptions('', [other], windows, 'auth').map((o) => o.kind),
    ['window'],
    'the thread you are in is not offered',
  );
  assert.deepEqual(
    mentionOptions('LOG', [other], windows, 'x').map((o) => o.kind),
    ['thread'],
  );
  assert.deepEqual(
    mentionOptions('LOG', [{ ...other, status: 'settled' }], windows, 'x').map(
      (o) => o.kind,
    ),
    [],
    'settled threads are not offered',
  );
});

test('a thread reference becomes a digest and a window reference its screenshot, in the prompt the agent gets', () => {
  const create: Action = {
    type: 'create',
    title: 'reply with ok',
    provider: 'claude',
    project: '/Users/me/dev/harness',
    isLive: true,
    controls: {
      model: 'sonnet-5.5',
      effort: 'Low',
      speed: '',
      access: 'Manual',
    },
  };
  let s = base();
  const id = calls(s, create)[0].threadId;
  s = threadsReducer(s, create);

  const mentions: Mention[] = [
    { kind: 'thread', id: 'auth', title: other.title },
    { kind: 'window', id: 'window:1', title: 'Safari — Docs', image: shot },
  ];
  const ref = withReferences(`why does @${other.title} loop?`, mentions, [
    other,
  ]);
  assert.equal(
    ref.text,
    `@Safari — Docs\n\nwhy does @${other.title} loop?`,
    'the thread stays inline where it was typed; only the window becomes a tag',
  );
  assert.match(
    ref.prompt,
    /<thread title="Fix &quot;login&quot; redirect">\nStatus: running, 1\/2 steps done, web on fix\/login\nyou: Keep the return URL in state\nclaude: Done\. x+…\n<\/thread>/,
  );
  assert.doesNotMatch(
    ref.prompt,
    /Edit src\/auth\.ts/,
    'tool calls stay out of the digest',
  );
  assert.match(
    ref.prompt,
    /<window title="Safari — Docs">Screenshot of this window attached\.<\/window>\n\nwhy does "Fix "login" redirect" loop\?$/,
  );

  const send: Action = {
    type: 'send',
    threadId: id,
    text: ref.text,
    prompt: ref.prompt,
    images: ref.images,
  };
  assert.deepEqual(calls(s, send), [
    {
      method: 'send',
      threadId: id,
      text: ref.prompt,
      images: [shot],
      policy: { speed: '', permissionMode: 'default' },
    },
  ]);
  const said = threadsReducer(s, send)
    .threads.find((t) => t.id === id)!
    .activity.at(-1)!;
  assert.equal(
    said.text,
    ref.text,
    'the transcript keeps your message, not the injected context',
  );
});

test("file tokens stay where typed in the transcript; the agent gets each in its harness's form", () => {
  const inside = worktreeMention('src/SidePane.tsx');
  const outside = fileMentionFor(
    '/Users/me/dev/harness',
    '../other/',
    '/Users/me/dev/other',
    'x.ts',
    false,
  );
  const message = 'compare @src/SidePane.tsx with @../other/x.ts';
  assert.deepEqual(
    withReferences(message, [inside, outside], [], { provider: 'claude' }),
    {
      text: message,
      prompt: 'compare @src/SidePane.tsx with @/Users/me/dev/other/x.ts',
      images: [],
      skills: [],
    },
  );
  assert.equal(
    withReferences(message, [inside, outside], [], { provider: 'codex' })
      .prompt,
    'compare src/SidePane.tsx with /Users/me/dev/other/x.ts',
  );
  const withThread = withReferences(
    `${message} like @${other.title}`,
    [inside, { kind: 'thread', id: 'auth', title: other.title }],
    [other],
    { provider: 'claude' },
  );
  assert.equal(
    withThread.text,
    `${message} like @${other.title}`,
    'no tags: files and threads are already in the text',
  );
  assert.match(
    withThread.prompt,
    /<\/thread>\n\ncompare @src\/SidePane\.tsx with @\.\.\/other\/x\.ts like "Fix "login" redirect"$/,
    'a file token without its mention is sent as typed',
  );
});

test('no references leaves the message alone', () => {
  assert.deepEqual(withReferences('hi', [], []), {
    text: 'hi',
    prompt: 'hi',
    images: [],
    skills: [],
  });
});

const skills = [
  { name: 'ui', description: 'Taste and craft for UI work' },
  { name: 'run', description: 'Launch the app' },
];
const servers = [
  { name: 'linear', status: 'connected' as const, toolCount: 12 },
];

test("@ also offers the thread's skills and MCP servers, by name, after threads and windows", () => {
  const windows = [{ id: 'window:1', title: 'Linear — Inbox' }];
  assert.deepEqual(
    mentionOptions('', [other], windows, 'x', skills, servers).map(
      (o) => o.kind,
    ),
    ['thread', 'window', 'skill', 'skill', 'mcp'],
  );
  assert.deepEqual(
    mentionOptions('lin', [other], windows, 'x', skills, servers).map(
      (o) => o.kind,
    ),
    ['window', 'mcp'],
  );
  assert.deepEqual(mentionFor({ kind: 'skill', skill: skills[0] }), {
    kind: 'skill',
    id: 'skill:ui',
    title: 'ui',
    description: 'Taste and craft for UI work',
  });
  assert.deepEqual(mentionFor({ kind: 'mcp', server: servers[0] }), {
    kind: 'mcp',
    id: 'mcp:linear',
    title: 'linear',
    toolCount: 12,
  });
});

test('a skill reference asks the agent to load it, an MCP reference to prefer its tools, after any context', () => {
  const mentions: Mention[] = [
    { kind: 'thread', id: 'auth', title: other.title },
    { kind: 'skill', id: 'skill:ui', title: 'ui', description: '' },
    { kind: 'mcp', id: 'mcp:claude.ai Linear', title: 'claude.ai Linear' },
  ];
  const claude = withReferences('fix the header', mentions, [other], {
    provider: 'claude',
  });
  assert.equal(
    claude.text,
    '@ui @claude.ai Linear\n\nfix the header',
    'a thread is inline, never a tag',
  );
  assert.match(
    claude.prompt,
    /<\/thread>\n\nFor this message, use the "ui" skill: load it with the Skill tool before you start\.\nFor this message, prefer the tools of the "claude\.ai Linear" MCP server \(mcp__claude_ai_Linear__\*\) over other ways to do the same thing\.\n\nfix the header$/,
  );
  assert.deepEqual(claude.skills, ['ui']);

  const codex = withReferences('/review', [mentions[1]], [], {
    isCommand: true,
    provider: 'codex',
  });
  assert.equal(
    codex.prompt,
    '/review\n\nFor this message, use the "ui" skill; its instructions are attached.',
    'a command stays first',
  );
  assert.doesNotMatch(
    codex.prompt,
    /referenced these for context/,
    'no context block without context',
  );
  assert.deepEqual(codex.skills, ['ui'], 'Codex attaches the skill item');
});

test('a plugin reference asks the agent to prefer what the plugin brings', () => {
  const plugin = mentionFor({ kind: 'plugin', plugin: 'emilkowalski' });
  assert.deepEqual(plugin, {
    kind: 'plugin',
    id: 'plugin:emilkowalski',
    title: 'emilkowalski',
  });
  const sent = withReferences('polish the menu', [plugin], [], {
    provider: 'claude',
  });
  assert.equal(sent.text, '@emilkowalski\n\npolish the menu');
  assert.match(
    sent.prompt,
    /prefer what the "emilkowalski" plugin brings .*named "emilkowalski:…"/,
  );
});

test('picked skills reach the agent call, so Codex can attach them', () => {
  const create: Action = {
    type: 'create',
    title: 'go',
    provider: 'codex',
    project: '/Users/me/dev/harness',
    isLive: true,
    controls: { model: 'gpt-5.5', effort: 'Low', speed: '', access: 'Manual' },
  };
  let s = base();
  const id = calls(s, create)[0].threadId;
  s = threadsReducer(s, create);
  const send: Action = {
    type: 'send',
    threadId: id,
    text: '@ui\n\ngo',
    prompt: 'p',
    images: [],
    skills: ['ui'],
  };
  assert.deepEqual(calls(s, send), [
    {
      method: 'send',
      threadId: id,
      text: 'p',
      skills: ['ui'],
      policy: { speed: '', permissionMode: 'default' },
    },
  ]);
});

test('the @ menu shows threads, windows, skills, connectors and plugins as five groups, in that order', () => {
  const windows = [
    { id: '4711', title: 'latitude-pact - Slack', app: 'Slack' },
  ];
  const groups = mentionGroups(
    mentionOptions('', [other], windows, 'x', skills, servers, [
      'emilkowalski',
    ]),
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.length]),
    [
      ['Threads', 1],
      ['Windows', 1],
      ['Skills', 2],
      ['Connectors', 1],
      ['Plugins', 1],
    ],
  );
  const blocked = mentionGroups([
    ...mentionOptions('', [other], [], 'x'),
    { kind: 'permission' as const },
  ]);
  assert.deepEqual(
    blocked.map((g) => g.label),
    ['Threads', 'Windows'],
    'without screen recording the Windows group holds the prompt to allow it',
  );
});

test('a /skill typed mid-text is sent as written and its name goes to the agent separately', () => {
  const items = slashItems(skills, 'claude', ['ui', 'run']);
  const message = 'use /ui skill on this';
  const claude = withReferences(message, [], [], {
    provider: 'claude',
    typedSkills: typedSkills(message, items),
  });
  assert.equal(
    claude.text,
    message,
    'the transcript shows it where you typed it',
  );
  assert.equal(
    claude.prompt,
    'For this message, use the "ui" skill: load it with the Skill tool before you start.\n\nuse /ui skill on this',
  );
  assert.deepEqual(claude.skills, ['ui']);

  const picked: Mention = {
    kind: 'skill',
    id: 'skill:ui',
    title: 'ui',
    description: '',
  };
  assert.deepEqual(
    withReferences(message, [picked], [], { typedSkills: ['ui'] }).skills,
    ['ui'],
    'picked and typed, asked once',
  );

  const create: Action = {
    type: 'create',
    title: message,
    prompt: claude.prompt,
    skills: claude.skills,
    provider: 'claude',
    project: '/Users/me/dev/harness',
    isLive: true,
    controls: {
      model: 'sonnet-5.5',
      effort: 'Low',
      speed: '',
      access: 'Manual',
    },
  };
  const [start] = calls(base(), create);
  assert.equal(start.method, 'start');
  assert.deepEqual(
    start.method === 'start' && {
      prompt: start.options.prompt,
      skills: start.options.skills,
    },
    { prompt: claude.prompt, skills: ['ui'] },
    'a new thread starts on it',
  );
  const s = threadsReducer(base(), create);
  assert.equal(s.threads.at(-1)!.title, message);

  const id = start.threadId;
  const send: Action = {
    type: 'send',
    threadId: id,
    text: claude.text,
    prompt: claude.prompt,
    images: [],
    skills: claude.skills,
  };
  assert.deepEqual(
    calls(s, send),
    [
      {
        method: 'send',
        threadId: id,
        text: claude.prompt,
        skills: ['ui'],
        policy: { speed: '', permissionMode: 'default' },
      },
    ],
    'a running thread gets it with the message',
  );
});
