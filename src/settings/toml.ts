import { parse, TomlError } from 'smol-toml';

export interface TomlTable {
  path: string[];
  isArray: boolean;
  /** Offset of the header's `[`. */
  start: number;
  /** Offset just past the header line. */
  bodyStart: number;
  /** Offset of the next header, or the end of the text. */
  end: number;
}

export type TomlDoc = Record<string, unknown>;

export function parseToml(text: string): { doc: TomlDoc; tables: TomlTable[] } {
  let doc: TomlDoc;
  try {
    doc = structuredClone(parse(text));
  } catch (error) {
    if (error instanceof TomlError) throw new Error(`config.toml line ${error.line}: ${error.message}`, { cause: error });
    throw error;
  }
  const tables: TomlTable[] = [];
  const tokens = new RegExp(TOML_TOKENS, 'g');
  let depth = 0;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const token = match[0];
    if (token === '[' && depth === 0 && /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', match.index - 1) + 1, match.index))) {
      const start = match.index;
      const newline = text.indexOf('\n', start);
      const bodyStart = newline < 0 ? text.length : newline + 1;
      let node = parse(text.slice(start, bodyStart)) as TomlDoc;
      const path: string[] = [];
      while (Object.keys(node).length) {
        const part = Object.keys(node)[0];
        path.push(part);
        const child = node[part];
        node = (Array.isArray(child) ? child[0] : child) as TomlDoc;
      }
      tables.push({ path, isArray: text.startsWith('[[', start), start, bodyStart, end: text.length });
      tokens.lastIndex = bodyStart;
      continue;
    }
    if (token === '[' || token === '{') depth++;
    if (token === ']' || token === '}') depth--;
  }
  tables.forEach((table, index) => (table.end = tables[index + 1]?.start ?? text.length));
  return { doc, tables };
}

// smol-toml owns parsing; this lexer only locates headers for comment-preserving edits, skipping strings and comments.
const TOML_TOKENS = /"""(?:\\[\s\S]|(?!""")[^\\])*""""{0,2}|'''[\s\S]*?''''{0,2}|"(?:\\[\s\S]|[^"\\])*"|'[^']*'|#[^\r\n]*|[[\]{}]/;

export const tomlKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key));

/** TOML basic strings accept JSON's escapes, so JSON is a safe serializer for strings, string arrays and booleans. */
export function tomlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (typeof value === 'object' && value !== null) return `{ ${Object.entries(value).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`).join(', ')} }`;
  return JSON.stringify(value);
}

/** Sets `key = value` in a table, replacing a single-line assignment of that key or adding one under the header. */
export function setTomlKey(text: string, table: TomlTable, key: string, value: unknown): string {
  const line = `${tomlKey(key)} = ${tomlValue(value)}`;
  const body = text.slice(table.bodyStart, table.end);
  const existing = new RegExp(`^[ \\t]*${escapeRegExp(tomlKey(key))}[ \\t]*=.*$`, 'm').exec(body);
  if (existing) return text.slice(0, table.bodyStart + existing.index) + line + text.slice(table.bodyStart + existing.index + existing[0].length);
  const at = table.bodyStart;
  const lead = at > 0 && text[at - 1] !== '\n' ? '\n' : '';
  return `${text.slice(0, at)}${lead}${line}\n${text.slice(at)}`;
}

/** Cuts tables out (with everything up to the next header) and returns where the first one was. */
export function removeTomlTables(text: string, doomed: TomlTable[]): { text: string; at: number } {
  let out = text;
  for (const t of [...doomed].sort((a, b) => b.start - a.start)) out = out.slice(0, t.start) + out.slice(t.end);
  return { text: out, at: doomed.length ? Math.min(...doomed.map((t) => t.start)) : out.length };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
