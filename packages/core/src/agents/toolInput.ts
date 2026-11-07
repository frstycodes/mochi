/** A tool call's arguments as they are saved on the thread: a Write's whole file or an Edit's old text would bloat every save, so each string past `STRING_MAX` characters keeps its start and says how much was cut. */
export function capInput(input: unknown): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined;
  return cap(input) as Record<string, unknown>;
}

// GAP: only strings are capped; an argument that is a huge array of short strings is saved whole.
export const STRING_MAX = 2000;

function cap(value: unknown): unknown {
  if (typeof value === 'string')
    return value.length > STRING_MAX
      ? `${value.slice(0, STRING_MAX)}… (${value.length - STRING_MAX} more characters)`
      : value;
  if (Array.isArray(value)) return value.map(cap);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, cap(v)]),
    );
  return value;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
