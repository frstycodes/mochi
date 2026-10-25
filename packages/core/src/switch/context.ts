import { Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { COMMAND_TYPE, type LoggedEvent } from '@mochi/domain';
import { Switch } from '@mochi/schema';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { Run } from '../run.ts';
import { Projection } from '../store/projection.ts';
import { PRIORITY, UtilityQueue } from '../utility/queue.ts';
import { BRIEF_EVERY, briefRequest, parseBrief } from './brief.ts';
import { contextPackage, PACKAGE_TOKENS } from './package.ts';
import { transcriptOf } from './transcript.ts';

/** The utility model call a brief job makes; null when no model answered. */
export type AskBrief = (
  spaceId: string,
  prompt: string,
) => Effect.Effect<string | null>;

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

const decodeStoredBrief = Schema.decodeUnknownOption(
  Schema.fromJsonString(Switch.ThreadBrief),
);

/**
 * Each thread's provider sessions and rolling brief (`PROVIDER-SWITCH.md` §1–4, §6). A switch detaches the sessions of the
 * other providers where the log ends, each keeping its native id (its latest `session` event) and what it last saw; the
 * provider switched to resumes its own detached session with what it missed, or starts fresh with the whole package. A
 * session keeps its package for every later launch, since instructions are set per launch.
 */
export class ThreadContext extends Context.Service<ThreadContext>()(
  'mochi/core/ThreadContext',
  {
    make: (ask: AskBrief) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const projection = yield* Projection;
        const queue = yield* UtilityQueue;
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

        const briefOf = (threadId: string) =>
          Effect.map(
            sql<{
              through_seq: number;
              brief_json: string;
            }>`SELECT through_seq, brief_json FROM thread_briefs WHERE thread_id = ${threadId}`,
            ([row]): Switch.StoredBrief | undefined => {
              const brief = row && decodeStoredBrief(row.brief_json);
              return brief && Option.isSome(brief)
                ? { throughSeq: row.through_seq, brief: brief.value }
                : undefined;
            },
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

        /**
         * What a start of `provider` on this thread runs with. After a switch, the package and the session to resume; any other
         * start, the package its active session was given.
         */
        const prepare = (
          threadId: string,
          provider: Provider,
          model: string | undefined,
          cwd: string | null,
          switchFrom: Provider | undefined,
        ): Effect.Effect<Prepared, unknown> =>
          Effect.gen(function* () {
            const target = yield* bindingOf(threadId, provider);
            if (!switchFrom)
              return target?.state === 'active' && target.context
                ? { context: target.context }
                : {};
            const events = yield* eventsOf(threadId, 0);
            const lastSeq = events.at(-1)?.sequence ?? 0;
            for (const [other, sessionId] of latestSessions(events))
              if (other !== provider)
                yield* detach(threadId, other, sessionId, lastSeq);
            const resume =
              target?.state === 'detached'
                ? (target.native_session_id ?? undefined)
                : undefined;
            const pkg = contextPackage({
              from: switchFrom,
              brief: yield* briefOf(threadId),
              items: transcriptOf(events),
              sinceSeq: resume ? target!.last_seen_seq : 0,
              ground: yield* groundOf(run, cwd),
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
                from: switchFrom,
                to: provider,
                ...(model && { model }),
                text: pkg.text,
                contents: pkg.contents,
              },
            };
          });

        /** Folds the events after the brief into it, once at least `BRIEF_EVERY` items are new; on the utility queue. */
        const updateBrief = (threadId: string) =>
          Effect.gen(function* () {
            const thread = (yield* projection.current).domain.threads.find(
              (t) => t.id === threadId,
            );
            if (!thread) return;
            const previous = yield* briefOf(threadId);
            const events = yield* eventsOf(threadId, previous?.throughSeq ?? 0);
            const items = transcriptOf(events);
            if (items.length < BRIEF_EVERY) return;
            const request = briefRequest(
              thread,
              previous,
              items,
              events.at(-1)!.sequence,
            );
            const answer = yield* queue.submit({
              thread: threadId,
              kind: 'brief',
              priority: PRIORITY.handoff,
              promptChars: request.prompt.length,
              run: ask(thread.spaceId, request.prompt),
            });
            const brief = answer && parseBrief(answer);
            if (!brief)
              return yield* Effect.logWarning(
                answer ? 'The brief model replied with no brief' : 'No brief',
              ).pipe(Effect.annotateLogs({ source: 'switch', threadId }));
            yield* sql`INSERT INTO thread_briefs (thread_id, through_seq, brief_json, updated_at)
              VALUES (${threadId}, ${request.throughSeq}, ${JSON.stringify(brief)}, ${now()})
              ON CONFLICT (thread_id) DO UPDATE SET through_seq = excluded.through_seq, brief_json = excluded.brief_json, updated_at = excluded.updated_at`;
          });

        return { prepare, updateBrief, briefOf, eventsOf };
      }),
  },
) {
  static readonly layer = (ask: AskBrief) => Layer.effect(this, this.make(ask));
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
