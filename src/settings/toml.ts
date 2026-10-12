/**
 * Just enough TOML to read Codex's `config.toml` and edit it in place: values (strings in all four forms, arrays, inline
 * tables, booleans, numbers; dates stay raw strings) plus where each table sits, so a write touches only its own table
 * and leaves the user's comments and layout alone.
 */

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
  const doc: TomlDoc = {};
  const tables: TomlTable[] = [];
  let current = doc;
  let i = 0;

  const fail = (message: string): never => {
    throw new Error(`config.toml line ${text.slice(0, i).split('\n').length}: ${message}`);
  };
  const skipSpace = () => {
    while (text[i] === ' ' || text[i] === '\t') i++;
  };
  const skipComment = () => {
    if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
  };
  const skipBlank = () => {
    for (;;) {
      skipSpace();
      skipComment();
      if (text[i] === '\n' || text[i] === '\r') i++;
      else return;
    }
  };
  const endOfLine = () => {
    skipSpace();
    skipComment();
    if (text[i] === '\r') i++;
    if (i < text.length && text[i] !== '\n') fail(`unexpected "${text[i]}"`);
    i++;
  };

  const basicString = (close: string) => {
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      if (text.startsWith(close, i)) {
        i += close.length;
        return out;
      }
      const c = text[i++];
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      if (e === 'u' || e === 'U') {
        const n = e === 'u' ? 4 : 8;
        out += String.fromCodePoint(parseInt(text.slice(i, i + n), 16));
        i += n;
      } else if (e === '\n' || e === '\r' || e === ' ' || e === '\t') {
        // Line-ending backslash in a multi-line string trims the newline and the indentation after it.
        while (/\s/.test(text[i] ?? '')) i++;
      } else out += ({ b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' } as Record<string, string>)[e] ?? fail(`bad escape \\${e}`);
    }
  };
  const literalString = (close: string) => {
    const end = text.indexOf(close, i);
    if (end < 0) fail('unterminated string');
    const out = text.slice(i, end);
    i = end + close.length;
    return out;
  };
  const string = (): string => {
    for (const [open, read] of [
      ['"""', () => basicString('"""')],
      ["'''", () => literalString("'''")],
      ['"', () => basicString('"')],
      ["'", () => literalString("'")],
    ] as const) {
      if (!text.startsWith(open, i)) continue;
      i += open.length;
      // A newline right after a multi-line opener is not part of the string.
      if (open.length === 3 && text[i] === '\n') i++;
      else if (open.length === 3 && text.startsWith('\r\n', i)) i += 2;
      return read();
    }
    return fail('expected a string');
  };

  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      skipSpace();
      if (text[i] === '"' || text[i] === "'") parts.push(string());
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i, i + 256));
        if (!m) fail('expected a key');
        parts.push(m![0]);
        i += m![0].length;
      }
      skipSpace();
      if (text[i] !== '.') return parts;
      i++;
    }
  };

  const value = (): unknown => {
    const c = text[i];
    if (c === '"' || c === "'") return string();
    if (c === '[') {
      i++;
      const list: unknown[] = [];
      for (;;) {
        skipBlank();
        if (text[i] === ']') return i++, list;
        list.push(value());
        skipBlank();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail('expected , or ]');
      }
    }
    if (c === '{') {
      i++;
      const table: TomlDoc = {};
      for (;;) {
        skipBlank();
        if (text[i] === '}') return i++, table;
        assign(table, key());
        skipBlank();
        if (text[i] === ',') i++;
        else if (text[i] !== '}') fail('expected , or }');
      }
    }
    const m = /^[^\s,\]}#]+/.exec(text.slice(i, i + 64));
    if (!m) fail('expected a value');
    i += m![0].length;
    const raw = m![0];
    if (raw === 'true' || raw === 'false') return raw === 'true';
    const n = Number(raw.replace(/_/g, ''));
    return Number.isNaN(n) || /^[+-]?(inf|nan)$/.test(raw) ? raw : n;
  };

  const assign = (target: TomlDoc, path: string[]) => {
    skipSpace();
    if (text[i] !== '=') fail('expected =');
    i++;
    skipSpace();
    const parent = descend(target, path.slice(0, -1));
    parent[path.at(-1)!] = value();
  };

  while (i < text.length) {
    skipBlank();
    if (i >= text.length) break;
    if (text[i] !== '[') {
      assign(current, key());
      endOfLine();
      continue;
    }
    const start = i;
    const isArray = text.startsWith('[[', i);
    i += isArray ? 2 : 1;
    const path = key();
    if (!text.startsWith(isArray ? ']]' : ']', i)) fail('expected ]');
    i += isArray ? 2 : 1;
    endOfLine();
    if (isArray) {
      const parent = descend(doc, path.slice(0, -1));
      const list = (Array.isArray(parent[path.at(-1)!]) ? parent[path.at(-1)!] : (parent[path.at(-1)!] = [])) as TomlDoc[];
      list.push((current = {}));
    } else current = descend(doc, path);
    tables.push({ path, isArray, start, bodyStart: Math.min(i, text.length), end: text.length });
  }
  tables.forEach((t, n) => (t.end = tables[n + 1]?.start ?? text.length));
  return { doc, tables };
}

/** Walks to (creating) the table at `path`; an array of tables resolves to its last entry, as TOML does. */
function descend(root: TomlDoc, path: string[]): TomlDoc {
  let node = root;
  for (const part of path) {
    let next = node[part];
    if (Array.isArray(next)) next = next.at(-1);
    if (typeof next !== 'object' || next === null) next = node[part] = {};
    node = next as TomlDoc;
  }
  return node;
}

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
