import type { ActivityEntry, AgentCommand, Thread } from '../../model';
import { WorkLog } from '../../WorkLog';
import { VizThreadProvider } from '../../viz/WidgetVisual';
import { Block } from '../layout';

/** Expanded calls like Claude desktop's: intent, every argument, then the result; agent-to-agent traffic as messaging rows. */
export function WorkLogDetailBlock({
  rl,
  parent,
}: {
  rl: Thread;
  parent: Thread;
}) {
  return (
    <Block
      title="Work log · expanded calls and messages"
      use="Open the group, then any row: the agent's why (when it isn't already the row), every argument as key and value (long text and objects fold to their first line and open to a code frame), then the call's own view or its raw result. A failed call stays visible with its error. Skills open to their description and what they were invoked with. A message to another thread and a sub-thread's report to its parent are the same messaging row."
      wide
    >
      <div className="w-[720px] max-w-full">
        <VizThreadProvider value={rl.id}>
          <WorkLog entries={demoEntries(rl, parent)} skills={SKILLS} />
        </VizThreadProvider>
      </div>
    </Block>
  );
}

const SKILLS: AgentCommand[] = [
  {
    name: 'sizing-the-change',
    description:
      'Use before writing the first line of a feature, helper or formatter: sizes the change to what was asked.',
  },
];

function demoEntries(rl: Thread, parent: Thread): ActivityEntry[] {
  const at = Date.now();
  const tool = (entry: Omit<ActivityEntry, 'at' | 'who' | 'kind'>) =>
    ({ at, who: 'claude', kind: 'tool', ...entry }) as const;
  return [
    tool({
      text: 'Skill sizing-the-change',
      skill: 'sizing-the-change',
      input: {
        skill: 'sizing-the-change',
        args: 'Store raw tool input on ActivityEntry and show it when a call opens',
      },
    }),
    tool({
      text: 'Run pnpm exec vp test run apps/desktop/src/chat',
      description: 'Run the chat tests',
      input: {
        command: 'pnpm exec vp test run apps/desktop/src/chat',
        description: 'Run the chat tests',
        timeout: 120000,
      },
      exitCode: 0,
      output: ' Test Files  14 passed (14)\n      Tests  96 passed (96)',
    }),
    tool({
      text: 'Mcp linear: get_issue',
      mcp: { server: 'linear', tool: 'get_issue' },
      input: {
        id: 'MOC-128',
        includeComments: true,
        fields: ['title', 'state', 'assignee', 'labels'],
      },
      output: JSON.stringify({
        id: 'MOC-128',
        title: 'Tool calls should open to their arguments',
        state: 'In Progress',
        assignee: 'Sandesh',
        labels: ['work-log', 'ui'],
      }),
    }),
    tool({
      text: 'Mcp github: create_pull_request',
      mcp: { server: 'github', tool: 'create_pull_request' },
      input: {
        owner: 'frstycodes',
        repo: 'mochi',
        title: 'feat(worklog): detailed expanded calls',
        head: 'feat/worklog-detail',
        base: 'main',
        body: '## Summary\n- Store raw tool input\n- Show intent, args and result when a call opens\n- Messaging rows for agent-to-agent traffic',
      },
      isError: true,
      output:
        'Validation failed: No commits between main and feat/worklog-detail',
    }),
    tool({
      text: 'Mcp mochi: send_to_thread',
      mcp: { server: 'mochi', tool: 'send_to_thread' },
      input: {
        threadId: rl.id,
        text: 'The schema change landed; rebase onto it before you touch WorkLog.tsx.',
        expectReply: true,
      },
      sent: {
        threadId: rl.id,
        title: rl.title,
        text: 'The schema change landed; rebase onto it before you touch WorkLog.tsx.',
      },
    }),
    tool({
      text: 'Mcp mochi: report_to_parent',
      mcp: { server: 'mochi', tool: 'report_to_parent' },
      input: {
        status: 'done',
        summary: 'Expanded calls show intent, args and result.',
        branch: 'feat/worklog-detail',
        pr: 7,
        changedFiles: [
          'apps/desktop/src/WorkLog.tsx',
          'apps/desktop/src/chat/CallDetail.tsx',
        ],
        checks: [{ command: 'pnpm typecheck', result: 'passed' }],
      },
      sent: {
        threadId: parent.id,
        title: parent.title,
        text: 'Expanded calls show intent, args and result.',
      },
    }),
  ];
}
