import type {
  AgentHost,
  AgentReviewEvent,
  AgentReviewRequest,
} from '../host/types/agent.ts';
import type { Verdict } from './verdict.ts';

const STEP_MS = 700;
const listeners = new Set<(event: AgentReviewEvent) => void>();
let nextId = 0;

/**
 * The demo adapter's second opinion: reads the files named in the prompt's diff one by one, then answers with a
 * scripted verdict about them. Used by the web build and by demo threads on desktop, which have no agent to ask.
 */
export const demoReviewer: Pick<AgentHost, 'review' | 'onReviewEvent'> = {
  async review(request) {
    const id = `demo-review-${++nextId}`;
    const files = diffFiles(request);
    const emit = (event: AgentReviewEvent) =>
      listeners.forEach((listener) => listener(event));
    const steps = [
      ...files.slice(0, 4).map((f) => `Read ${f}`),
      'Grep TODO|FIXME',
    ];
    steps.forEach((text, i) =>
      setTimeout(() => emit({ id, type: 'step', text }), 300 + i * STEP_MS),
    );
    setTimeout(
      () =>
        emit({ id, type: 'done', result: JSON.stringify(demoVerdict(files)) }),
      300 + steps.length * STEP_MS,
    );
    return { id };
  },
  onReviewEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

function diffFiles({ prompt }: AgentReviewRequest) {
  return [
    ...new Set([...prompt.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1])),
  ];
}

export function demoVerdict(files: string[]): Verdict {
  const [first, second] = files;
  if (!first)
    return {
      verdict: 'approve',
      summary:
        'There is no diff against the base branch yet, so there is nothing to object to.',
      findings: [],
    };
  return {
    verdict: 'concerns',
    summary: `The change does what the goal asks, but ${first.split('/').pop()} misses an edge case and one goal step has no test.`,
    findings: [
      {
        file: first,
        line: 12,
        severity: 'high',
        text: 'An empty list falls through to the success branch, so callers get a total of 0 instead of an error.',
      },
      ...(second
        ? [
            {
              file: second,
              line: 4,
              severity: 'medium' as const,
              text: 'This import is only used in a test; move it there so the bundle does not pull it in.',
            },
          ]
        : []),
      {
        file: '',
        severity: 'low',
        text: 'The goal asks for a test of the empty case; none of the changed tests cover it.',
      },
    ],
  };
}
