import type { Source } from './model.ts';

/** What you typed into "Add a source": a URL (with or without its scheme) or a path in the thread's folder. */
export function sourceFrom(input: string): Source | null {
  const label = input.trim();
  if (!label) return null;
  return { kind: isUrl(label) ? 'link' : 'file', label };
}

/** A link source's address for the browser; labels are stored scheme-less like the fixtures'. */
export function sourceUrl(label: string) {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(label) ? label : `https://${label}`;
}

/** A trailing slash marks a folder, which opens in the Files tab rather than the file viewer. */
export const isFolderSource = (source: Source) =>
  source.kind === 'file' && source.label.endsWith('/');

/** What the agent is told when you add a source mid-thread; it lands in the transcript as your message. */
export function sourcePrompt(source: Source) {
  return `I added a source to this thread: ${source.label}. ${source.kind === 'link' ? 'Read it' : 'Look at it'} where it helps with the goal.`;
}

// ponytail: a host needs a dotted first segment followed by a path (`redis.io/docs`) or a `www.` prefix; a bare `example.com`
// reads as a file name (`README.md` looks the same), so type the scheme for those.
function isUrl(text: string) {
  return (
    /^[a-z][a-z\d+.-]*:\/\//i.test(text) ||
    /^www\./i.test(text) ||
    /^[\w-]+(\.[\w-]+)+(:\d+)?\//.test(text)
  );
}
