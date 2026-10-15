const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(.*)$/;

/**
 * What ⌘Enter does on the caret's line when it is a `- ` / `* ` / `+ ` / `1. ` / `1) ` item: insert the next item's marker,
 * or, on an item with no text yet, clear its marker to end the list. `null` off a list line.
 */
export function continueList(text: string, caret: number): { insert: string } | { clearFrom: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = text.indexOf('\n', caret);
  const match = LIST_ITEM.exec(text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd));
  if (!match) return null;
  const [, indent, bullet, number, delimiter, content] = match;
  if (!content.trim()) return { clearFrom: lineStart };
  return { insert: `\n${indent}${bullet ?? `${Number(number) + 1}${delimiter}`} ` };
}
