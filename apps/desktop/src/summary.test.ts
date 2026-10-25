import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry } from './model.ts';
import {
  describeApproval,
  eventLine,
  isApprovalChatter,
  summarize,
  toolCall,
  turnSummary,
} from './summary.ts';

const tool = (text: string, at = 0): ActivityEntry => ({
  at,
  who: 'claude',
  kind: 'tool',
  text,
});

test('a finished work group reads as counts by importance, plural-aware, like Claude', () => {
  const entries = [
    tool('Search a'),
    tool('Search b'),
    tool('Search c'),
    tool('Search d'),
    tool('Run pnpm test'),
    tool('Edit src/a.ts  +3 −1'),
    tool('Edit src/a.ts  +1 −0'),
    tool('Edit src/b.ts  +2 −2'),
    {
      at: 1,
      who: 'harness',
      kind: 'event',
      text: 'Waiting on you: search the web',
    } satisfies ActivityEntry,
    {
      at: 1,
      who: 'you',
      kind: 'event',
      text: 'Approved: search the web',
    } satisfies ActivityEntry,
  ];
  assert.equal(
    turnSummary(entries),
    'Edited 2 files, ran 1 command, searched the web 4 times',
  );
  assert.equal(
    turnSummary([tool('Run a'), tool('Run b'), tool('Run c')]),
    'Ran 3 commands',
  );
  assert.equal(
    turnSummary([
      tool('Mcp mochi: get_goal'),
      tool('Mcp mochi: add_step'),
      tool('Mcp linear: get_issue'),
    ]),
    'Used Mochi twice, called 1 MCP tool',
  );
  assert.equal(
    turnSummary([
      tool('Search a'),
      tool('Search b'),
      tool('Read a.ts'),
      tool('Read b.ts'),
      tool('Read c.ts'),
      tool('Read d.ts'),
    ]),
    'Searched the web twice, read 4 files',
  );
  assert.equal(
    turnSummary([tool('Search a'), tool('Fetch https://x.dev')]),
    'Searched the web, read 1 page',
  );
  assert.equal(
    turnSummary([{ at: 0, who: 'claude', kind: 'reasoning', text: '…' }]),
    'Thought it through',
  );
});

test("an edit's diff stats come from its patch when the agent sent one", () => {
  const patch = '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d';
  assert.deepEqual(toolCall({ text: 'Edit src/x.ts', patch }), {
    verb: 'Edit',
    target: 'src/x.ts',
    added: 2,
    removed: 1,
  });
});

test('approvals read as sentences, never raw JSON', () => {
  assert.equal(
    describeApproval('WebSearch', {
      query: 'EX271UZ review',
      allowed_domains: [
        'rtings.com',
        'tftcentral.co.uk',
        'a',
        'b',
        'c',
        'd',
        'e',
      ],
    }),
    'search the web for “EX271UZ review” on rtings.com, tftcentral.co.uk +5 more',
  );
  assert.equal(
    describeApproval('WebFetch', { url: 'https://www.rtings.com/monitor' }),
    'read rtings.com/monitor',
  );
  assert.equal(describeApproval('Grep', { pattern: 'x' }), undefined);
  assert.equal(
    eventLine(
      'Approved: {\n  "query": "BenQ EX271UZ review video YouTube",\n  "mode": "standard"\n}',
    ),
    'Approved: search the web for “BenQ EX271UZ review video YouTube”',
  );
  assert.equal(
    eventLine('Approved: Search the web for “x”'),
    'Approved: search the web for “x”',
  );
  assert.equal(
    eventLine('Waiting on you: WebSearch'),
    'Waiting on you: WebSearch',
  );
  assert.equal(eventLine('Goal v2: +1 step'), 'Goal v2: +1 step');
  assert.deepEqual(
    ['Waiting on you: x', 'Approved: x', 'Denied: x', 'Goal v2: +1 step'].map(
      isApprovalChatter,
    ),
    [true, true, false, false],
  );
});

test('skills used and MCP calls by server come from the log, out of the built-in tool counts', () => {
  const skill = (name: string, at: number): ActivityEntry => ({
    ...tool(`Skill ${name}`, at),
    skill: name,
  });
  const mcp = (server: string, name: string): ActivityEntry => ({
    ...tool(`Mcp ${server}: ${name}`),
    mcp: { server, tool: name },
  });
  const summary = summarize([
    skill('ui', 1),
    tool('Run pnpm test'),
    skill('dataviz', 2),
    skill('ui', 5),
    mcp('linear', 'get_issue'),
    mcp('figma', 'get_screenshot'),
    mcp('linear', 'get_issue'),
    mcp('linear', 'list_issues'),
  ]);
  assert.deepEqual(summary.skills, [
    { name: 'ui', uses: 2, lastAt: 5 },
    { name: 'dataviz', uses: 1, lastAt: 2 },
  ]);
  assert.deepEqual(summary.servers, [
    { server: 'linear', calls: 3, tools: ['get_issue', 'list_issues'] },
    { server: 'figma', calls: 1, tools: ['get_screenshot'] },
  ]);
  assert.deepEqual(
    summary.tools,
    [{ verb: 'Run', count: 1 }],
    'MCP calls no longer count as commands',
  );
  assert.equal(summary.toolTotal, 5);
  assert.equal(
    turnSummary([
      skill('ui', 0),
      skill('ui', 0),
      mcp('linear', 'get_issue'),
      tool('Run x'),
    ]),
    'Ran 1 command, used 1 skill, called 1 MCP tool',
  );
});
