import type { BrowserDialog } from '../host/types/browser.ts';

/** What the agent hears while a dialog blocks the page: every other browser tool on the tab fails with it. */
export const dialogNote = ({ kind, message }: BrowserDialog) => `${kind === 'alert' ? 'An' : 'A'} ${kind} dialog is open: ${JSON.stringify(message)}; answer it with browser_dialog`;
