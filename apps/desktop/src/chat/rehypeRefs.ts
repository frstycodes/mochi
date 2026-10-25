import { refKey, splitRefs } from '@mochi/domain/chat/refs';

type HastText = { type: 'text'; value: string };
type HastElement = {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
};
type HastNode =
  | HastText
  | HastElement
  | { type: string; children?: HastNode[] };
type HastParent = { children?: HastNode[] };

const SKIP = new Set([
  'a',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'kbd',
  'script',
  'style',
]);

// The empty slug stands for the thread's own repo: a rehype plugin can't read React context, so the link renderer resolves
// `#n` (and drops it when the thread has no GitHub repo).
const DEFERRED_HOME = { owner: '', repo: '' };

/**
 * Rehype plugin: `owner/repo#n`, `#n` and file paths in prose become `<a data-ref>` / `<a data-path>` for the chat's link
 * renderer. Runs after sanitize and harden, so the links it adds aren't stripped; headings, code and existing links are left alone.
 */
export function rehypeRefs() {
  return (tree: HastParent) => walk(tree, linkify);
}

/**
 * Rehype plugin, after `rehypeRefs`: each known `/name` (`names`), at the start of a text run or after a space, becomes an
 * info-coloured span, as it was in the composer. Links and code are left alone.
 */
export function rehypeSlashTokens(names: readonly string[]) {
  const known = new Set(names);
  return (tree: HastParent) => walk(tree, (value) => slashSpans(value, known));
}

function slashSpans(
  value: string,
  known: ReadonlySet<string>,
): HastNode[] | null {
  const hits = [...value.matchAll(/(?<=^|\s)\/(\S+)/g)].filter((m) =>
    known.has(m[1]),
  );
  if (!hits.length) return null;
  const nodes: HastNode[] = [];
  let at = 0;
  for (const m of hits) {
    if (m.index > at)
      nodes.push({ type: 'text', value: value.slice(at, m.index) });
    nodes.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['text-info'] },
      children: [{ type: 'text', value: m[0] }],
    });
    at = m.index + m[0].length;
  }
  if (at < value.length) nodes.push({ type: 'text', value: value.slice(at) });
  return nodes;
}

function walk(
  parent: HastParent,
  replace: (value: string) => HastNode[] | null,
) {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === 'element' && SKIP.has((node as HastElement).tagName))
      continue;
    if (node.type !== 'text') {
      walk(node as HastParent, replace);
      continue;
    }
    const replaced = replace((node as HastText).value);
    if (!replaced) continue;
    children.splice(i, 1, ...replaced);
    i += replaced.length - 1;
  }
}

function linkify(value: string): HastNode[] | null {
  const segments = splitRefs(value, DEFERRED_HOME);
  if (segments.length === 1 && segments[0].type === 'text') return null;
  return segments.map((s): HastNode => {
    if (s.type === 'text') return { type: 'text', value: s.text };
    const properties =
      s.type === 'ref'
        ? { href: s.text, dataRef: refKey(s.ref) }
        : { href: s.text, dataPath: s.text };
    return {
      type: 'element',
      tagName: 'a',
      properties,
      children: [{ type: 'text', value: s.text }],
    };
  });
}

/**
 * Rehype plugin, before harden: a markdown link to a bare relative path (`[x](src/a.ts)`) gets a `./` prefix, the only
 * relative form harden lets through without a default origin; the link renderer then checks the file exists.
 */
export function rehypeRelativeLinks() {
  return (tree: HastParent) => prefixRelative(tree);
}

const HAS_SCHEME_OR_ROOT = /^(?:[a-z][a-z\d+.-]*:|\/|\.{1,2}\/|#|\?)/i;

function prefixRelative(parent: HastParent) {
  for (const node of parent.children ?? []) {
    if (node.type !== 'element') continue;
    const el = node as HastElement;
    const href = el.properties?.href;
    if (
      el.tagName === 'a' &&
      typeof href === 'string' &&
      href &&
      !HAS_SCHEME_OR_ROOT.test(href)
    )
      el.properties!.href = `./${href}`;
    prefixRelative(el);
  }
}
