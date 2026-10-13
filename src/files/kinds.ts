export const PREVIEW_KINDS = {
  image: /\.(png|jpe?g|gif|webp|avif|ico|bmp)$/i,
  svg: /\.svg$/i,
  pdf: /\.pdf$/i,
  markdown: /\.(md|mdx|markdown)$/i,
  json: /\.json$/i,
  csv: /\.(csv|tsv)$/i,
} satisfies Record<string, RegExp>;

export type PreviewKind = keyof typeof PREVIEW_KINDS;

export function previewKind(path: string) {
  return (Object.keys(PREVIEW_KINDS) as PreviewKind[]).find((kind) => PREVIEW_KINDS[kind].test(path)) ?? null;
}

// Attachments can arrive without a telling extension (pasted files, `blob` names); the media type fills in.
const MEDIA_KINDS: Record<string, PreviewKind | undefined> = {
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/markdown': 'markdown',
  'text/csv': 'csv',
  'text/tab-separated-values': 'csv',
  'image/svg+xml': 'svg',
};

export function fileKind(name: string, mediaType?: string) {
  if (!mediaType) return previewKind(name);
  return previewKind(name) ?? MEDIA_KINDS[mediaType] ?? (mediaType.startsWith('image/') ? 'image' : null);
}

// Past this, CodeMirror and the markdown and table renderers get slow enough to freeze the window.
export const MAX_TEXT_PREVIEW = 2_000_000;

export type ViewerBody = PreviewKind | 'code' | 'none';

/** What the file viewer shows for a loaded file: a preview, read-only highlighted source, or the can't-preview state. */
export function viewerBody(kind: PreviewKind | null, content: { kind: 'text'; text: string } | { kind: 'binary' }): ViewerBody {
  if (content.kind === 'binary') return kind === 'image' || kind === 'pdf' ? kind : 'none';
  if (content.text.length > MAX_TEXT_PREVIEW) return 'none';
  return kind ?? 'code';
}

/** Preview kinds whose source is readable text, so the viewer offers a preview/source toggle. */
export function hasTextSource(body: ViewerBody) {
  return body === 'markdown' || body === 'json' || body === 'csv' || body === 'svg';
}

const PATH = /^(?:\.{0,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z0-9]+(?::\d+){0,2}$/;
const KNOWN_EXTENSION = /\.(tsx?|jsx?|mjs|cjs|json|jsonc|md|mdx|css|scss|html?|py|rs|go|ya?ml|toml|sh|csv|tsv|txt|pdf|svg|png|jpe?g|gif|webp|lock)$/i;

/** Inline code that names a file: `src/a.ts`, `src/a.ts:12`, `package.json`. A bare `name.ext` needs a known extension so `latitude.sid` stays code. */
export function isFilePath(text: string) {
  if (!PATH.test(text)) return false;
  const path = text.replace(/(?::\d+)+$/, '');
  return path.includes('/') || KNOWN_EXTENSION.test(path);
}

/** RFC 4180: quoted fields may hold the delimiter, newlines and `""` escapes. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let isQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (isQuoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') isQuoted = false;
      else field += c;
    } else if (c === '"' && field === '') isQuoted = true;
    else if (c === delimiter) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push([...row, field]);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

/**
 * A path from chat (`./src/a.ts:12`, `/abs/root/src/a.ts`, `/src/a.ts`, `src/a.ts#L12`) → the viewer link `src/a.ts:12` when that file exists
 * in `files` (relative to `root`); null otherwise, so only real files become links.
 */
export function worktreeLink(text: string, root: string, files: ReadonlySet<string>) {
  const m = text.match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L\d+)?)?$/)!;
  const line = m[2] ?? m[3];
  let path = m[1];
  try {
    path = decodeURI(path);
  } catch {
    // A stray `%` in a plain-text path: use it as written.
  }
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  // Harden turns a markdown link's `./src/a.ts` into the root-relative `/src/a.ts`.
  else if (path.startsWith('/')) path = path.slice(1);
  path = path.replace(/^(?:\.\/)+/, '');
  if (!files.has(path)) return null;
  return line ? `${path}:${line}` : path;
}
