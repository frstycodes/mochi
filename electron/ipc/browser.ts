import { existsSync } from 'node:fs';
import { app, net, shell } from 'electron';
import type { BrowserHost } from '../../src/host/types/browser.ts';
import { startCompare, stopCompare } from '../browser/compare.ts';
import { browserLabel, parseSuggestions, SUGGEST_URLS } from '../browser/external.ts';
import { resolveCwd } from '../pty/cwd.ts';
import { actOnView, answerDialogInView, findInView, menuCommandInView, peekView, stopFindInView, scrollView, setAutoReload, evalInView, waitForView, cancelPick, captureView, clearSpaceData, createView, destroyView, emulateView, navigateView, pickElement, runCommand, setDevtools, setViewBounds, setViewMirror, setViewZoom, snapshotView, viewLogs } from '../browser/views.ts';
import type { Handlers } from './handlers.ts';

const SUGGEST_TIMEOUT_MS = 2500;

export const browser = {
  async create(sender, options) {
    return createView(sender, options.url, options.spaceId);
  },
  async destroy(sender, id) {
    destroyView(sender, id);
  },
  async navigate(sender, id, to) {
    navigateView(sender, id, to);
  },
  async command(sender, id, command) {
    runCommand(sender, id, command);
  },
  async setBounds(sender, id, bounds) {
    setViewBounds(sender, id, bounds);
  },
  async mirror(sender, id, viewport) {
    await setViewMirror(sender, id, viewport);
  },
  async setZoom(sender, id, factor) {
    setViewZoom(sender, id, factor);
  },
  async emulate(sender, id, emulation) {
    await emulateView(sender, id, emulation);
  },
  async devtools(sender, id, mode) {
    setDevtools(sender, id, mode);
  },
  async capture(sender, id, options) {
    return captureView(sender, id, options.fullPage);
  },
  async pick(sender, id) {
    return pickElement(sender, id);
  },
  async cancelPick(sender, id) {
    await cancelPick(sender, id);
  },
  async clearData(_sender, id) {
    await clearSpaceData(id);
  },
  async snapshot(sender, id) {
    return snapshotView(sender, id);
  },
  async act(sender, id, act) {
    return actOnView(sender, id, act);
  },
  async logs(sender, id) {
    return viewLogs(sender, id);
  },
  async eval(sender, id, script) {
    return evalInView(sender, id, script);
  },
  async waitFor(sender, id, until) {
    return waitForView(sender, id, until);
  },
  async answerDialog(sender, id, answer) {
    await answerDialogInView(sender, id, answer.accept);
  },
  async autoReload(sender, id, root) {
    setAutoReload(sender, id, root === null ? null : resolveCwd(root));
  },
  async scroll(sender, id, to) {
    return scrollView(sender, id, to);
  },
  async compareStart(_sender, threadId, cwd, base) {
    return startCompare(threadId, resolveCwd(cwd), base);
  },
  async compareStop(_sender, threadId) {
    await stopCompare(threadId);
  },
  async find(sender, id, text, options) {
    findInView(sender, id, text, options);
  },
  async stopFind(sender, id) {
    stopFindInView(sender, id);
  },
  async menuCommand(sender, id, command, at, saveUrl) {
    menuCommandInView(sender, id, command, at, saveUrl);
  },
  async peek(sender, id) {
    return peekView(sender, id);
  },
  async openExternal(_sender, to) {
    await shell.openExternal(to);
  },
  async showDownload(_sender, path) {
    if (!existsSync(path)) throw new Error('The file is no longer there');
    shell.showItemInFolder(path);
  },
  async defaultBrowser() {
    return browserLabel(app.getApplicationNameForProtocol('https://'), app.getName());
  },
  async suggest(_sender, engine, query) {
    const q = query.trim();
    if (!q) return [];
    const res = await net.fetch(SUGGEST_URLS[engine] + encodeURIComponent(q), { signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS) }).catch(() => null);
    return res?.ok ? parseSuggestions(await res.json().catch(() => null)) : [];
  },
} satisfies Handlers<BrowserHost>;
