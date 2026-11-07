/** One argument of a call as the expanded row shows it: short values inline, long text and objects as a folded code block. */
export type CallArg =
  | { key: string; kind: 'inline'; text: string }
  | {
      key: string;
      kind: 'block';
      code: string;
      language: 'json' | 'text';
      preview: string;
    };

/** Every argument but `description` (the intent) and the keys the row's own view already shows (`shown`), in the agent's order. */
export function callArgs(
  input: Record<string, unknown> | undefined,
  shown: readonly string[] = [],
): CallArg[] {
  if (!input) return [];
  return Object.entries(input)
    .filter(
      ([key, value]) =>
        key !== 'description' && !shown.includes(key) && value !== undefined,
    )
    .map(([key, value]) => toArg(key, value));
}

const INLINE_MAX = 80;

function toArg(key: string, value: unknown): CallArg {
  if (typeof value !== 'object' || value === null) {
    const text = String(value);
    if (text.length <= INLINE_MAX && !text.includes('\n'))
      return { key, kind: 'inline', text };
    return {
      key,
      kind: 'block',
      code: text,
      language: 'text',
      preview: firstLine(text),
    };
  }
  const code = JSON.stringify(value, null, 2);
  return {
    key,
    kind: 'block',
    code,
    language: 'json',
    preview: firstLine(JSON.stringify(value)),
  };
}

const firstLine = (text: string) => text.trimStart().split('\n')[0];

/** The agent's own why for the call (Claude's Bash and Agent `description`); undefined when the row already reads as it. */
export function callIntent(
  input: Record<string, unknown> | undefined,
  rowText: string,
) {
  const intent =
    typeof input?.description === 'string' ? input.description.trim() : '';
  return intent && intent !== rowText ? intent : undefined;
}

/** A call's raw result for the code frame: JSON pretty-printed when it parses, else the text as it came. */
export function resultCode(output: string): {
  code: string;
  language: 'json' | 'text';
} {
  const text = output.trim();
  if (!/^[[{]/.test(text)) return { code: output, language: 'text' };
  try {
    return {
      code: JSON.stringify(JSON.parse(text), null, 2),
      language: 'json',
    };
  } catch {
    return { code: output, language: 'text' };
  }
}

/** A Markdown fence around `code` that its own backticks can't close early. */
export function fenced(code: string, language: string) {
  const longest = Math.max(
    2,
    ...(code.match(/`+/g) ?? []).map((b) => b.length),
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}
