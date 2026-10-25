import { toast } from '@/toast/store';
import { host } from '@/host';
import { threadCwd } from '@/host/cwd';
import type { Thread } from '@/model';
import { dataUrlToFile, sendToComposer } from './composer';
import {
  basePageKey,
  destroyPage,
  getPage,
  updatePage,
  type CompareState,
  type Page,
} from './pages';
import { displayUrl } from './url';
import { plural } from '@/lib/format';

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
    deliver(
      thread,
      `On \`${picked.selector}\` at ${displayUrl(page.url)}:\n\n\`\`\`html\n${picked.html}\n\`\`\`\n\n`,
      [file],
      'Element added to the composer',
    );
  } catch (error) {
    toast.error('Could not pick the element', { description: String(error) });
  } finally {
    updatePage(key, { isPicking: false });
  }
}

/** The demo page has no real DOM to read, so it sends the element's name only. */
export function pickDemoElement(key: string, thread: Thread, target: string) {
  updatePage(key, { isPicking: false });
  deliver(
    thread,
    `On "${target}" in the preview: `,
    [],
    'Element added to the composer',
  );
}

/** Captures into the annotation editor; sending from there attaches it to the composer. */
export async function screenshot(key: string, page: Page, fullPage: boolean) {
  if (!page.hostId) return;
  try {
    updatePage(key, {
      annotating: {
        image: await host.browser.capture(page.hostId, { fullPage }),
        name: fullPage ? 'page-full.png' : 'page.png',
      },
    });
  } catch (error) {
    toast.error('Could not take the screenshot', {
      description: String(error),
    });
  }
}

export async function sendAnnotated(
  key: string,
  thread: Thread,
  png: Blob,
  name: string,
  isMarked: boolean,
) {
  deliver(
    thread,
    '',
    [new File([png], name, { type: 'image/png' })],
    isMarked
      ? 'Annotated screenshot added to the composer'
      : 'Screenshot added to the composer',
  );
  updatePage(key, { annotating: null });
}

export async function toggleAutoReload(
  key: string,
  page: Page,
  thread: Thread,
) {
  const cwd = threadCwd(thread);
  if (!page.hostId || !cwd) return;
  const isOn = !page.isAutoReloading;
  updatePage(key, { isAutoReloading: isOn });
  try {
    await host.browser.autoReload(page.hostId, isOn ? cwd : null);
  } catch (error) {
    updatePage(key, { isAutoReloading: !isOn });
    toast.error('Could not watch the worktree', { description: String(error) });
  }
}

/** Serves the thread's base branch and shows it beside this page. */
export async function openCompare(key: string, thread: Thread) {
  const cwd = threadCwd(thread);
  if (!cwd) return;
  updatePage(key, { compare: { mode: 'split', status: 'starting' } });
  const settle = (next: CompareState) =>
    getPage(key)?.compare?.status === 'starting' &&
    updatePage(key, { compare: next });
  try {
    const base = await host.browser.compareStart(
      thread.id,
      cwd,
      thread.repo?.base,
    );
    settle({ mode: 'split', status: 'ready', base });
  } catch (error) {
    // Electron prefixes errors thrown in main with the channel name.
    settle({
      mode: 'split',
      status: 'error',
      message: String(error instanceof Error ? error.message : error).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      ),
    });
  }
}

export function closeCompare(key: string, threadId: string) {
  updatePage(key, { compare: null });
  destroyPage(basePageKey(key));
  void host.browser.compareStop(threadId);
}

export function consoleReport(page: Page) {
  const lines = page.console.map(
    (c) =>
      `${c.level}: ${c.message}${c.source ? ` (${displayUrl(c.source)}:${c.line})` : ''}`,
  );
  return `The preview at ${displayUrl(page.url)} logged ${plural(page.console.length, 'this', 'these')} in the console. Can you fix ${plural(page.console.length, 'it', 'them')}?\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function deliver(thread: Thread, text: string, files: File[], success: string) {
  if (sendToComposer({ threadId: thread.id, text, files })) toast(success);
  else toast.error('Open the thread to attach this');
}
