import type { BrowserBounds, BrowserCommand, BrowserDevtools, BrowserEmulation, BrowserHost } from '../../src/host/types/browser.ts';
import { cancelPick, captureView, createView, destroyView, emulateView, isAllowedUrl, navigateView, pickElement, runCommand, setDevtools, setViewBounds, setViewZoom } from '../browser/views.ts';
import { record, string, type Handlers } from './handlers.ts';

const COMMANDS = ['back', 'forward', 'reload', 'hard-reload', 'stop'] satisfies BrowserCommand[];
const DEVTOOLS = ['docked', 'detached', 'closed'] satisfies BrowserDevtools[];

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
} satisfies Handlers<BrowserHost>;

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
  return { x: number(r.x, 'x', -1e5, 1e5), y: number(r.y, 'y', -1e5, 1e5), width: number(r.width, 'width', 0, 1e5), height: number(r.height, 'height', 0, 1e5) };
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
