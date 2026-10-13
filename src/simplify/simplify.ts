import type { Prefs } from '../settings/prefs.ts';

const MAX_LOCAL_BULLETS = { short: 5, detailed: 10 } satisfies Record<Prefs['simplifyLength'], number>;
const FENCE = /```[\s\S]*?```/g;

/** What a simplification depends on: change any of these and stored ones are out of date. */
export const rulesKey = (p: Pick<Prefs, 'simplifyLength' | 'simplifyNeedsFirst' | 'simplifyRules'>) => JSON.stringify([p.simplifyLength, p.simplifyNeedsFirst, p.simplifyRules.trim()]);

/** The background model's prompt: your Simplify settings, then the reply. */
export function simplifyPrompt(text: string, p: Pick<Prefs, 'simplifyLength' | 'simplifyNeedsFirst' | 'simplifyRules'>) {
  const rules = [
    p.simplifyLength === 'short' ? `At most ${MAX_LOCAL_BULLETS.short} bullets.` : 'As many bullets as the facts need, one line each.',
    p.simplifyNeedsFirst && 'If anything needs the reader (a question, a decision, something to check), put it first, starting with "Needs you:".',
    p.simplifyRules.trim() && `The reader's own rules: ${p.simplifyRules.trim()}`,
  ].filter(Boolean);
  return `${rules.join('\n')}\n\nReply to simplify:\n${text}`;
}

/** No model answered (web build, offline): one bullet per sentence of prose, code blocks kept whole after them. */
export function localSimplify(text: string, length: Prefs['simplifyLength']) {
  const blocks = text.match(FENCE) ?? [];
  const sentences = text
    .replace(FENCE, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-*#>\d.\s]+/, '').trim())
    .filter((s) => s.length > 2)
    .slice(0, MAX_LOCAL_BULLETS[length]);
  return [...sentences.map((s) => `- ${s}`), ...blocks].join('\n');
}

export const wordCount = (text: string) => text.replace(FENCE, ' ').split(/\s+/).filter(Boolean).length;
