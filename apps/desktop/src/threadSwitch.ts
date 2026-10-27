/** The thread `by` steps from `fromId` in `ids`, wrapping at both ends; from no thread (or one no longer listed), next is the first and previous the last. */
export function stepThread(
  ids: readonly string[],
  fromId: string | undefined,
  by: 1 | -1,
) {
  if (!ids.length) return undefined;
  const at = fromId === undefined ? -1 : ids.indexOf(fromId);
  if (at === -1) return by === 1 ? ids[0] : ids.at(-1);
  return ids[(at + by + ids.length) % ids.length];
}
