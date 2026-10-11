import { toast } from 'sonner';
import { host } from '@/host';
import type { Thread } from '@/model';
import { dataUrlToFile, sendToComposer } from './composer';
import { updatePage, type Page } from './pages';
import { displayUrl } from './url';

/** Desktop: the next click in the page picks an element. Web demo page: toggles its own comment mode. */
export async function togglePick(key: string, page: Page, thread: Thread) {
  if (page.isPicking) {
    updatePage(key, { isPicking: false });
    if (page.hostId) await host.browser.cancelPick(page.hostId);
    return;
  }
  updatePage(key, { isPicking: true });
  if (!page.hostId) return;
  try {
    const picked = await host.browser.pick(page.hostId);
    if (!picked) return;
    const file = await dataUrlToFile(picked.screenshot, 'element.png');
    deliver(thread, `On \`${picked.selector}\` at ${displayUrl(page.url)}:\n\n\`\`\`html\n${picked.html}\n\`\`\`\n\n`, [file], 'Element added to the composer');
  } catch (error) {
    toast.error('Could not pick the element', { description: String(error) });
  } finally {
    updatePage(key, { isPicking: false });
  }
}

/** The demo page has no real DOM to read, so it sends the element's name only. */
export function pickDemoElement(key: string, thread: Thread, target: string) {
  updatePage(key, { isPicking: false });
  deliver(thread, `On "${target}" in the preview: `, [], 'Element added to the composer');
}

export async function screenshot(page: Page, thread: Thread, fullPage: boolean) {
  if (!page.hostId) return;
  try {
    const file = await dataUrlToFile(await host.browser.capture(page.hostId, { fullPage }), fullPage ? 'page-full.png' : 'page.png');
    deliver(thread, '', [file], fullPage ? 'Full-page screenshot added to the composer' : 'Screenshot added to the composer');
  } catch (error) {
    toast.error('Could not take the screenshot', { description: String(error) });
  }
}

export function consoleReport(page: Page) {
  const lines = page.console.map((c) => `${c.level}: ${c.message}${c.source ? ` (${displayUrl(c.source)}:${c.line})` : ''}`);
  return `The preview at ${displayUrl(page.url)} logged ${page.console.length === 1 ? 'this' : 'these'} in the console. Can you fix ${page.console.length === 1 ? 'it' : 'them'}?\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function deliver(thread: Thread, text: string, files: File[], success: string) {
  if (sendToComposer({ threadId: thread.id, text, files })) toast(success);
  else toast.error('Open the thread to attach this');
}
