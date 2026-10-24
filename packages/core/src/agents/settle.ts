/** The agent sessions a thread owns among `ids`: its own, and its delegated tasks (`<thread>--<agent>`, `backgroundSession` in src/runtime/subagents.ts). */
export function threadSessions(threadId: string, ids: Iterable<string>) {
  return [...new Set(ids)].filter((id) => id === threadId || id.startsWith(`${threadId}--`));
}
