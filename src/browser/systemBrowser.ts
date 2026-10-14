import { host } from '@/host';

let name = '';
// Asked once at startup; menus read it when they open, long after this resolves.
if (host.isDesktop) void host.browser.defaultBrowser().then((n) => (name = n), () => {});

/** "Open in Arc" ("Open link in Arc" with `what`), or "… in your browser" when the OS doesn't name its default browser. */
export function openInLabel(what?: string) {
  return `Open${what ? ` ${what}` : ''} in ${name || 'your browser'}`;
}

export function openExternally(url: string) {
  void host.browser.openExternal(url);
}
