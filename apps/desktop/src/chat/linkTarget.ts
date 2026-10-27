import { isMod } from '../keys';

interface LinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Where a click on a link in a thread opens: the side pane's browser, the system browser (⌘/Ctrl-click, middle click), or nowhere (any other button). */
export function linkTarget(e: LinkClick, isMac?: boolean) {
  if (e.button === 1) return 'external';
  if (e.button !== 0) return null;
  return isMod(e, isMac) ? 'external' : 'pane';
}

export function isWebUrl(href: string) {
  return /^https?:\/\//i.test(href);
}
