/** Main writes exported pages with these, so this file imports nothing from the renderer's store. */
export const PAYLOAD_ID = 'mochi-replay';

/**
 * The app's built page (one file, every script and style inlined, `vite-plugin-singlefile`) with the replay as a JSON
 * script: opened anywhere, `readEmbeddedReplay` finds it and the app renders only the replay. `<` is escaped so text
 * like `</script>` inside the recording can't end the tag.
 */
export function embedReplay(html: string, payload: unknown, title: string): string {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const named = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(`Replay: ${title}`)}</title>`);
  const at = named.lastIndexOf('</body>');
  if (at < 0) throw new Error('The app page has no </body>');
  return `${named.slice(0, at)}<script type="application/json" id="${PAYLOAD_ID}">${json}</script>\n${named.slice(at)}`;
}

/**
 * False for a dev server's page, which loads its modules over the network: Vite injects `<script type="module"
 * src="/@vite/client">`. Matched with the attribute's quote, since the single-file build inlines this very source as
 * text, and the escaped slashes keep the pattern from matching itself.
 */
export const isSelfContained = (html: string) => !/src="\/@vite\/client"/.test(html);

export const replayFileName = (title: string) => `${title.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'thread'}-replay.html`;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
