import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { COMMAND_TYPE, type LoggedEvent } from '@mochi/domain';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import type { SwitchFrom } from '../../../../apps/desktop/src/host/types/agent.ts';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { Run } from '../run.ts';
import { writeHandoff, type HandoffAsk } from './handoff.ts';
import { contextPackage, PACKAGE_TOKENS } from './package.ts';
import { transcriptOf, type TranscriptItem } from './transcript.ts';

/** A side turn for a thread's handoff, run in its folder on its profile. */
export type AskThreadSession = (
  threadId: string,
  spaceId: string,
  cwd: string,
  ask: HandoffAsk,
) => Effect.Effect<string | null>;

/** A start of `provider` on the thread; `switchFrom` set when the thread switched to it (or, the same provider, ran out of usage). */
export interface Start {
  readonly threadId: string;
  readonly spaceId: string;
  readonly provider: Provider;
  readonly model?: string;
  readonly cwd: string;
  readonly switchFrom?: SwitchFrom;
  /** The message this start sends: already in the log, so not repeated in the package. */
  readonly prompt?: string;
  /** Told when the handoff starts being written, so the thread can say so. */
  readonly onWriting?: () => void;
}

/** What a start runs with after a switch: the earlier session of its provider to resume, and the package for its instructions. */
interface Prepared {
  readonly resume?: string;
  readonly context?: string;
  /** Set when this start delivers a package: the `context` event that records it on the thread. */
  readonly delivered?: Omit<
    Extract<AgentEvent, { type: 'context' }>,
    'threadId' | 'type'
  >;
}

interface Binding {
  native_session_id: string | null;
  last_seen_seq: number;
  state: 'active' | 'detached' | 'lost';
  context: string | null;
}

/**
 * Each thread's provider sessions (`PROVIDER-SWITCH.md` §1, §3, §6). Nothing happens when you pick another provider: the start
 * your next message makes detaches the other sessions where the log ends, each keeping its native id (its latest `session`
 * event) and what it last saw; the provider switched to resumes its own detached session with what it missed, or starts fresh
 * from a handoff and the latest turns. A session keeps its package for every later launch, since instructions are set per launch.
 */
export class ThreadContext extends Context.Service<ThreadContext>()(
  'mochi/core/ThreadContext',
  {
    make: (askSession: AskThreadSession) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const run = yield* Run;
        const now = () => new Date().toISOString();

        /** The thread's commands and agent events; its snapshots (`thread.saved`) hold nothing the transcript reads. */
        const eventsOf = (threadId: string, afterSeq: number) =>
          Effect.map(
            sql<{
              sequence: number;
              event_type: string;
              payload_json: string;
              occurred_at: string;
            }>`SELECT sequence, event_type, payload_json, occurred_at FROM events
              WHERE thread_id = ${threadId} AND sequence > ${afterSeq} AND (event_type = ${COMMAND_TYPE} OR event_type LIKE 'agent.%')
              ORDER BY sequence`,
            (rows): LoggedEvent[] =>
              rows.map((r) => ({
                sequence: r.sequence,
                type: r.event_type,
                threadId,
                payload: JSON.parse(r.payload_json),
                at: Date.parse(r.occurred_at),
              })),
          );

        const bindingOf = (threadId: string, provider: Provider) =>
          Effect.map(
            sql<Binding>`SELECT native_session_id, last_seen_seq, state, context FROM thread_sessions WHERE thread_id = ${threadId} AND provider = ${provider}`,
            ([row]) => row as Binding | undefined,
          );

        /** An active (or never recorded) session of `provider` steps aside at `lastSeq`; a detached one keeps what it saw then. */
        const detach = (
          threadId: string,
          provider: Provider,
          sessionId: string,
          lastSeq: number,
        ) =>
          sql`INSERT INTO thread_sessions (thread_id, provider, native_session_id, last_seen_seq, state, updated_at)
            VALUES (${threadId}, ${provider}, ${sessionId}, ${lastSeq}, 'detached', ${now()})
            ON CONFLICT (thread_id, provider) DO UPDATE SET native_session_id = excluded.native_session_id,
              last_seen_seq = excluded.last_seen_seq, state = 'detached', updated_at = excluded.updated_at
            WHERE thread_sessions.state = 'active'`;

        /** The handoff a fresh session after a switch starts from, written now; the thread is told it is being written. */
        const handoffFor = (
          start: Start & { switchFrom: SwitchFrom },
          fromSession: string | undefined,
          items: ReadonlyArray<TranscriptItem>,
        ) =>
          Effect.andThen(
            Effect.sync(() => start.onWriting?.()),
            writeHandoff(
              (ask) =>
                askSession(start.threadId, start.spaceId, start.cwd, ask),
              {
                from: start.switchFrom.provider,
                ...(start.switchFrom.model && {
                  fromModel: start.switchFrom.model,
                }),
                fromSession,
                to: start.provider,
                ...(start.model && { model: start.model }),
                isLimited:
                  start.switchFrom.provider === start.provider ||
                  !!start.switchFrom.isLimited,
                items,
              },
            ),
          );

        /**
         * What a start of `provider` on this thread runs with. After a switch, the package and the session to resume; any other
         * start, the package its active session was given. The same provider switching to itself is a fresh session after a
         * usage limit: it resumes nothing and writes its own handoff.
         */
        const prepare = (start: Start): Effect.Effect<Prepared, unknown> =>
          Effect.gen(function* () {
            const { threadId, provider, model, switchFrom } = start;
            const target = yield* bindingOf(threadId, provider);
            if (!switchFrom)
              return target?.state === 'active' && target.context
                ? { context: target.context }
                : {};
            const events = yield* eventsOf(threadId, 0);
            const lastSeq = events.at(-1)?.sequence ?? 0;
            const sessions = latestSessions(events);
            const from = switchFrom.provider;
            const isFresh = from === provider;
            for (const [other, sessionId] of sessions)
              if (other !== provider || isFresh)
                yield* detach(threadId, other, sessionId, lastSeq);
            const resume =
              !isFresh && target?.state === 'detached'
                ? (target.native_session_id ?? undefined)
                : undefined;
            const items = withoutPrompt(transcriptOf(events), start.prompt);
            // A session coming back holds the thread up to where it left; what it missed goes verbatim.
            const handoff = resume
              ? null
              : yield* handoffFor(
                  { ...start, switchFrom },
                  sessions.get(from),
                  items,
                );
            const pkg = contextPackage({
              from,
              to: provider,
              handoff,
              items,
              sinceSeq: resume ? target!.last_seen_seq : 0,
              ground: yield* groundOf(run, start.cwd),
              budget: PACKAGE_TOKENS,
            });
            yield* sql`INSERT INTO thread_sessions (thread_id, provider, native_session_id, model, last_seen_seq, state, context, updated_at)
              VALUES (${threadId}, ${provider}, ${resume ?? null}, ${model ?? null}, ${lastSeq}, 'active', ${pkg.text}, ${now()})
              ON CONFLICT (thread_id, provider) DO UPDATE SET native_session_id = excluded.native_session_id, model = excluded.model,
                last_seen_seq = excluded.last_seen_seq, state = 'active', context = excluded.context, updated_at = excluded.updated_at`;
            return {
              ...(resume && { resume }),
              context: pkg.text,
              delivered: {
                from,
                to: provider,
                ...(model && { model }),
                ...(handoff && { handoffBy: handoff.by }),
                text: pkg.text,
                contents: pkg.contents,
              },
            };
          });

        /** The thread's transcript, for `thread_history`. */
        const transcript = (threadId: string) =>
          Effect.map(eventsOf(threadId, 0), transcriptOf);

        return { prepare, transcript };
      }),
  },
) {
  static readonly layer = (askSession: AskThreadSession) =>
    Layer.effect(this, this.make(askSession));
}

/** The transcript without its last item when that is the message the start is sending. */
function withoutPrompt(items: TranscriptItem[], prompt: string | undefined) {
  const last = items.at(-1);
  return last?.kind === 'you' && last.text === prompt
    ? items.slice(0, -1)
    : items;
}

/** Each provider's latest native session id in the thread's log. */
function latestSessions(events: ReadonlyArray<LoggedEvent>) {
  const sessions = new Map<Provider, string>();
  for (const event of events)
    if (event.type === 'agent.session') {
      const session = event.payload as Extract<AgentEvent, { type: 'session' }>;
      sessions.set(session.provider, session.sessionId);
    }
  return sessions;
}

/** `git status`, the diff stat, branch and HEAD in `cwd`; '' when it isn't a repo. */
const groundOf = (run: Run['Service'], cwd: string | null) =>
  Effect.gen(function* () {
    if (!cwd) return '';
    const git = (...args: string[]) =>
      run.run('git', args, { cwd, timeout: '5 seconds' }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.orElseSucceed(() => ''),
      );
    const [branch, head, status, stat] = yield* Effect.all(
      [
        git('branch', '--show-current'),
        git('log', '-1', '--format=%h %s'),
        git('status', '--short'),
        git('diff', '--stat', 'HEAD'),
      ],
      { concurrency: 'unbounded' },
    );
    if (!head) return '';
    return [
      `Branch ${branch || '(detached)'} at ${head}`,
      status ? `git status --short:\n${status}` : 'Clean working tree',
      stat && `git diff --stat HEAD:\n${stat}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
