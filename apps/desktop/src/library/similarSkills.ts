import type { Provider } from '../model';
import type { NativeAccount } from './useNativeItems';

/** A Claude Code or Codex skill whose name looks like `name`'s, so installing `name` may only duplicate it. */
export interface SimilarSkill {
  name: string;
  provider: Provider;
}

/** The native skills (every account's, deduplicated by harness and name) whose names resemble `name`. */
export function similarNativeSkills(
  name: string,
  accounts: NativeAccount[] | undefined,
): SimilarSkill[] {
  const seen = new Set<string>();
  return (accounts ?? []).flatMap(({ account, items }) =>
    items.flatMap((item) => {
      const key = `${account.provider}:${item.name}`;
      if (
        item.kind !== 'skill' ||
        seen.has(key) ||
        !isSimilarName(name, item.name)
      )
        return [];
      seen.add(key);
      return [{ name: item.name, provider: account.provider }];
    }),
  );
}

// Words that say nothing about what a skill does, so "ui-skill" and "ui" read as the same.
const FILLER = new Set([
  'skill',
  'skills',
  'agent',
  'claude',
  'codex',
  'the',
  'a',
  'and',
  'for',
]);

const words = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w));

/**
 * Same words after dropping filler, or every word of the shorter name inside the longer one ("animate" in
 * "animate-expo"). A name-only heuristic: two skills with different names that do the same thing aren't caught.
 */
export function isSimilarName(a: string, b: string) {
  const [short, long] = [words(a), words(b)].sort(
    (x, y) => x.length - y.length,
  );
  if (!short.length) return false;
  if (short.join('-') === long.join('-')) return true;
  // One short word ("ui", "git") inside a longer name is too weak a signal on its own.
  return short.join('').length >= 5 && short.every((w) => long.includes(w));
}
