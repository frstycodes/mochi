import { isAbsolute } from 'node:path';
import { app, net, shell } from 'electron';
import type { BrowserAct, BrowserBounds, BrowserCommand, BrowserDevtools, BrowserEmulation, BrowserHost, BrowserMenuCommand } from '../../src/host/types/browser.ts';
import { startCompare, stopCompare } from '../browser/compare.ts';
import { browserLabel, parseSuggestions, SUGGEST_URLS, type SuggestEngine } from '../browser/external.ts';
import { resolveCwd } from '../pty/cwd.ts';
import { actOnView, findInView, menuCommandInView, peekView, stopFindInView, scrollView, setAutoReload, evalInView, waitForView, cancelPick, captureView, clearSpaceData, createView, destroyView, emulateView, isAllowedUrl, navigateView, pickElement, runCommand, setDevtools, setViewBounds, setViewMirror, setViewZoom, snapshotView, viewLogs } from '../browser/views.ts';
import { record, string, type Handlers } from './handlers.ts';

// Under main's 30s limit for one Mochi call.
const MAX_WAIT_MS = 25_000;
const COMMANDS = ['back', 'forward', 'reload', 'hard-reload', 'stop'] satisfies BrowserCommand[];
const DEVTOOLS = ['docked', 'detached', 'closed'] satisfies BrowserDevtools[];
const MENU_COMMANDS = ['cut', 'copy', 'paste', 'select-all', 'copy-image', 'save-image', 'inspect'] satisfies BrowserMenuCommand[];
const ENGINES = Object.keys(SUGGEST_URLS) as SuggestEngine[];
const SUGGEST_TIMEOUT_MS = 2500;

export const browser = {
  async create(sender, options) {
    const o = record(options, 'options');
    return createView(sender, url(o.url), spaceId(o.spaceId));
  },
  async destroy(sender, id) {
    destroyView(sender, viewId(id));
  },
  async navigate(sender, id, to) {
    navigateView(sender, viewId(id), url(to));
  },
  async command(sender, id, command) {
    runCommand(sender, viewId(id), oneOf(command, COMMANDS, 'command'));
  },
  async setBounds(sender, id, bounds) {
    setViewBounds(sender, viewId(id), bounds === null ? null : rect(bounds));
  },
  async mirror(sender, id, viewport) {
    const v = viewport === null ? null : record(viewport, 'viewport');
    await setViewMirror(sender, viewId(id), v && { width: number(v.width, 'width', 1, 8192), height: number(v.height, 'height', 1, 8192) });
  },
  async setZoom(sender, id, factor) {
    setViewZoom(sender, viewId(id), number(factor, 'factor', 0.1, 5));
  },
  async emulate(sender, id, emulation) {
    await emulateView(sender, viewId(id), emulationOf(emulation));
  },
  async devtools(sender, id, mode) {
    setDevtools(sender, viewId(id), oneOf(mode, DEVTOOLS, 'mode'));
  },
  async capture(sender, id, options) {
    return captureView(sender, viewId(id), bool(record(options, 'options').fullPage, 'fullPage'));
  },
  async pick(sender, id) {
    return pickElement(sender, viewId(id));
  },
  async cancelPick(sender, id) {
    await cancelPick(sender, viewId(id));
  },
  async clearData(_sender, id) {
    await clearSpaceData(spaceId(id));
  },
  async snapshot(sender, id) {
    return snapshotView(sender, viewId(id));
  },
  async act(sender, id, act) {
    return actOnView(sender, viewId(id), actOf(act));
  },
  async logs(sender, id) {
    return viewLogs(sender, viewId(id));
  },
  async eval(sender, id, script) {
    return evalInView(sender, viewId(id), string(script, 'script', 100_000));
  },
  async waitFor(sender, id, until) {
    const u = record(until, 'until');
    const optional = (v: unknown, name: string) => (v === undefined ? undefined : string(v, name, 2048));
    return waitForView(sender, viewId(id), { text: optional(u.text, 'text'), selector: optional(u.selector, 'selector'), url: optional(u.url, 'url'), timeoutMs: number(u.timeoutMs, 'timeoutMs', 0, MAX_WAIT_MS) });
  },
  async autoReload(sender, id, root) {
    setAutoReload(sender, viewId(id), root === null ? null : resolveCwd(root));
  },
  async scroll(sender, id, to) {
    const pos = to === null ? null : record(to, 'to');
    return scrollView(sender, viewId(id), pos && { x: number(pos.x, 'x', 0, 1e7), y: number(pos.y, 'y', 0, 1e7) });
  },
  async compareStart(_sender, threadId, cwd, base) {
    return startCompare(threadKey(threadId), resolveCwd(cwd), base === undefined ? undefined : string(base, 'base', 255));
  },
  async compareStop(_sender, threadId) {
    await stopCompare(threadKey(threadId));
  },
  async find(sender, id, text, options) {
    const o = record(options, 'options');
    findInView(sender, viewId(id), string(text, 'text', 1000), { forward: bool(o.forward, 'forward'), isNewSearch: bool(o.isNewSearch, 'isNewSearch'), matchCase: bool(o.matchCase, 'matchCase') });
  },
  async stopFind(sender, id) {
    stopFindInView(sender, viewId(id));
  },
  async menuCommand(sender, id, command, at, saveUrl) {
    const p = record(at, 'at');
    const target = saveUrl === undefined ? undefined : string(saveUrl, 'url', 1_000_000);
    if (target !== undefined && !isAllowedUrl(target) && !target.startsWith('data:image/')) throw new TypeError('url must be http(s) or an image data URL');
    menuCommandInView(sender, viewId(id), oneOf(command, MENU_COMMANDS, 'command'), { x: number(p.x, 'x', -1e5, 1e5), y: number(p.y, 'y', -1e5, 1e5) }, target);
  },
  async peek(sender, id) {
    return peekView(sender, viewId(id));
  },
  async openExternal(_sender, to) {
    const target = url(to);
    if (!/^https?:/i.test(target)) throw new TypeError('url must be http(s)');
    await shell.openExternal(target);
  },
  async defaultBrowser() {
    return browserLabel(app.getApplicationNameForProtocol('https://'), app.getName());
  },
  async suggest(_sender, engine, query) {
    const q = string(query, 'query', 500).trim();
    if (!q) return [];
    const res = await net.fetch(SUGGEST_URLS[oneOf(engine, ENGINES, 'engine')] + encodeURIComponent(q), { signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS) }).catch(() => null);
    return res?.ok ? parseSuggestions(await res.json().catch(() => null)) : [];
  },
} satisfies Handlers<BrowserHost>;

function threadKey(value: unknown) {
  const s = string(value, 'threadId', 64);
  if (!/^[\w-]+$/.test(s)) throw new TypeError('threadId must be letters, digits, - or _');
  return s;
}

function actOf(value: unknown): BrowserAct {
  const a = record(value, 'act');
  const ref = (v: unknown) => {
    const s = string(v, 'ref', 16);
    if (!/^e\d+$/.test(s)) throw new TypeError('ref must look like e12');
    return s;
  };
  if (a.kind === 'click') return { kind: 'click', ref: ref(a.ref) };
  if (a.kind === 'hover') return { kind: 'hover', ref: ref(a.ref) };
  if (a.kind === 'select') return { kind: 'select', ref: ref(a.ref), value: string(a.value, 'value', 2048) };
  if (a.kind === 'drag') return { kind: 'drag', from: ref(a.from), to: ref(a.to) };
  if (a.kind === 'upload') {
    const path = string(a.path, 'path', 4096);
    if (!isAbsolute(path)) throw new TypeError('path must be absolute');
    return { kind: 'upload', ref: ref(a.ref), path };
  }
  if (a.kind === 'type') return { kind: 'type', ref: ref(a.ref), text: string(a.text, 'text', 20_000) };
  if (a.kind === 'press') return { kind: 'press', key: string(a.key, 'key', 32) };
  if (a.kind === 'scroll') return { kind: 'scroll', ref: a.ref === undefined ? undefined : ref(a.ref), dx: number(a.dx, 'dx', -1e5, 1e5), dy: number(a.dy, 'dy', -1e5, 1e5) };
  throw new TypeError('act.kind must be click, hover, type, select, drag, upload, press or scroll');
}

function url(value: unknown) {
  const s = string(value, 'url', 8192);
  if (!isAllowedUrl(s)) throw new TypeError('url must be http(s) or about:');
  return s;
}

function viewId(value: unknown) {
  const s = string(value, 'id', 32);
  if (!/^view-\d+$/.test(s)) throw new TypeError('id is not a view id');
  return s;
}

function spaceId(value: unknown) {
  const s = string(value, 'spaceId', 64);
  if (!/^[a-z0-9-]+$/.test(s)) throw new TypeError('spaceId must be lowercase letters, digits and dashes');
  return s;
}

function number(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`${name} must be a number in ${min}–${max}`);
  return value;
}

function bool(value: unknown, name: string) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: T[], name: string): T {
  if (!options.includes(value as T)) throw new TypeError(`${name} must be one of ${options.join(', ')}`);
  return value as T;
}

function rect(value: unknown): BrowserBounds {
  const r = record(value, 'bounds');
  return { x: number(r.x, 'x', -1e5, 1e5), y: number(r.y, 'y', -1e5, 1e5), width: number(r.width, 'width', 0, 1e5), height: number(r.height, 'height', 0, 1e5), radius: number(r.radius, 'radius', 0, 100) };
}

function emulationOf(value: unknown): BrowserEmulation {
  const e = record(value, 'emulation');
  const scheme = e.colorScheme === null ? null : oneOf(e.colorScheme, ['light', 'dark'], 'colorScheme');
  return {
    width: number(e.width, 'width', 0, 1e4),
    height: number(e.height, 'height', 0, 1e4),
    scale: number(e.scale, 'scale', 0.05, 1),
    dpr: number(e.dpr, 'dpr', 0, 4),     mobile: bool(e.mobile, 'mobile'),
    touch: bool(e.touch, 'touch'),
    colorScheme: scheme,
    reducedMotion: bool(e.reducedMotion, 'reducedMotion'),
  };
}
