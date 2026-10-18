interface AriaRef {
  ref: string;
  role: string;
  name: string;
}

/** A ref as the agent sees it: the snapshot's generation, then Playwright's own ref (`e12`, or `f1e3` inside an iframe). */
export const AGENT_REF = /^g\d+-(?:f\d+)?e\d+$/;

const MAX_CHARS = 40_000;
// `- role "name" [attr] [ref=e3]`, the whole key single-quoted by YAML when it holds a `:` or a quote.
const LINE = /^(\s*- )('?)([\w-]+)( "(?:[^"\\]|\\.)*")?((?: \[[^\]]*\])*)/;
const REF_ATTR = /\[ref=((?:f\d+)?e\d+)\]/;

/**
 * Playwright's `ariaSnapshot({ mode: 'ai' })` with each ref prefixed by `generation`, so a ref from an older snapshot can't
 * reach an element that has since taken its number. Cut to `MAX_CHARS` at a line; the refs are those left in the text.
 */
export function agentSnapshot(yaml: string, generation: number): { text: string; refs: AriaRef[] } {
  const refs: AriaRef[] = [];
  const lines: string[] = [];
  let size = 0;
  for (const line of hideSecrets(yaml).split('\n')) {
    const labelled = label(line, generation);
    size += labelled.line.length + 1;
    if (size > MAX_CHARS) {
      lines.push('- … (page truncated)');
      break;
    }
    lines.push(labelled.line);
    if (labelled.ref) refs.push(labelled.ref);
  }
  return { text: lines.join('\n') || '- (empty page)', refs };
}

/**
 * Client secrets and tokens an agent sets up an app next to (Google's `GOCSPX-…`, Slack's 32 hex digits and `xox…-` tokens)
 * never reach it: Mochi reads them from the page itself (`readRefValue`). GAP: a screenshot still shows them; 32-hex hashes on other pages hide too.
 */
export function hideSecrets(text: string) {
  return text.replace(/GOCSPX-[\w-]+/g, '[secret hidden by Mochi]').replace(/xox[a-z](?:\.xox[a-z])?-[\w-]+/g, '[secret hidden by Mochi]').replace(/\b[0-9a-f]{32}\b/gi, '[secret hidden by Mochi]');
}

function label(line: string, generation: number): { line: string; ref?: AriaRef } {
  const match = LINE.exec(line);
  const ref = match?.[5] && REF_ATTR.exec(match[5])?.[1];
  if (!match || !ref) return { line };
  const [head, indent, quote, role, quotedName = '', attrs] = match;
  const agentRef = `g${generation}-${ref}`;
  return {
    line: indent + quote + role + quotedName + attrs.replace(REF_ATTR, `[ref=${agentRef}]`) + line.slice(head.length),
    ref: { ref: agentRef, role, name: nameOf(quotedName, !!quote) },
  };
}

/** The Playwright selector for an agent ref, or `null` when it's from another snapshot than `generation`. */
export function ariaSelector(agentRef: string, generation: number) {
  const dash = agentRef.indexOf('-');
  if (!AGENT_REF.test(agentRef) || agentRef.slice(1, dash) !== String(generation)) return null;
  return `aria-ref=${agentRef.slice(dash + 1)}`;
}

function nameOf(quoted: string, isYamlQuoted: boolean) {
  if (!quoted) return '';
  const raw = quoted.slice(1);
  const json = isYamlQuoted ? raw.replaceAll("''", "'") : raw;
  try {
    return JSON.parse(json) as string;
  } catch {
    return json.slice(1, -1);
  }
}
