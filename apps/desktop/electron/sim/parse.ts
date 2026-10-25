import {
  CONTENT_SIZES,
  type SimAppearance,
  type SimButton,
  type SimContentSize,
  type Simulator,
  type SimTouchPhase,
} from '@mochi/domain/host/types/sim';

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  deviceTypeIdentifier?: string;
}

const STATES = ['Booted', 'Booting', 'Shutdown', 'Shutting Down'] as const;

/** Parses `xcrun simctl list -j devices`: available iOS iPhones and iPads, booted first, newest runtime first. */
export function parseSimctlList(json: string): Simulator[] {
  const { devices } = JSON.parse(json) as {
    devices: Record<string, SimctlDevice[]>;
  };
  return Object.entries(devices)
    .flatMap(([runtimeId, list]) => {
      const runtime = runtimeName(runtimeId);
      if (!runtime) return [];
      return list.flatMap((d) => {
        const family = deviceFamily(d.deviceTypeIdentifier ?? d.name);
        const state = STATES.find((s) => s === d.state);
        if (d.isAvailable === false || !family || !state) return [];
        return [
          {
            udid: d.udid,
            name: d.name,
            runtime,
            state,
            family,
          } satisfies Simulator,
        ];
      });
    })
    .sort(
      (a, b) =>
        Number(b.state === 'Booted') - Number(a.state === 'Booted') ||
        b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-2` → `iOS 26.2`; null for watchOS, tvOS, visionOS. */
function runtimeName(id: string) {
  const match = /SimRuntime\.iOS-(\d+)-(\d+)$/.exec(id);
  return match ? `iOS ${match[1]}.${match[2]}` : null;
}

function deviceFamily(typeId: string): Simulator['family'] | null {
  if (/iPad/i.test(typeId)) return 'ipad';
  if (/iPhone/i.test(typeId)) return 'iphone';
  return null;
}

// Args from the renderer reach execFile, so every value is checked against a closed shape before use.

export function udid(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/i.test(value)
  )
    throw new TypeError('udid must be a simulator UDID');
  return value;
}

export function bundleId(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(value)
  )
    throw new TypeError('bundle id must be reverse-DNS');
  return value;
}

/** Any scheme (deep links), but parsed and never option-like. */
export function url(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || value.startsWith('-'))
    throw new TypeError('url must be a URL up to 2048 chars');
  if (!URL.canParse(value)) throw new TypeError(`not a URL: ${value}`);
  return value;
}

export function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  name: string,
): T {
  const match = options.find((o) => o === value);
  if (!match)
    throw new TypeError(`${name} must be one of ${options.join(', ')}`);
  return match;
}

export const appearance = (value: unknown) =>
  oneOf<SimAppearance>(value, ['light', 'dark'], 'appearance');
export const contentSize = (value: unknown) =>
  oneOf<SimContentSize>(value, CONTENT_SIZES, 'content size');
export const button = (value: unknown) =>
  oneOf<SimButton>(value, ['home', 'lock', 'side', 'siri'], 'button');
export const touchPhase = (value: unknown) =>
  oneOf<SimTouchPhase>(value, ['down', 'move', 'up'], 'phase');

export function unit(value: unknown, name: string) {
  if (typeof value !== 'number' || !(value >= 0 && value <= 1))
    throw new TypeError(`${name} must be within 0...1`);
  return value;
}

export function hidUsage(value: unknown) {
  if (
    !Number.isInteger(value) ||
    (value as number) < 4 ||
    (value as number) > 231
  )
    throw new TypeError('usage must be a HID keyboard usage');
  return value as number;
}

export const SHIFT = 225;

// US layout, HID usage page 7. Each entry: [unshifted, shifted] characters on one key.
const KEYS: [number, string, string][] = [
  ...[...'abcdefghijklmnopqrstuvwxyz'].map((c, i): [number, string, string] => [
    4 + i,
    c,
    c.toUpperCase(),
  ]),
  ...[...'1234567890'].map((c, i): [number, string, string] => [
    30 + i,
    c,
    '!@#$%^&*()'[i],
  ]),
  [40, '\n', ''],
  [43, '\t', ''],
  [44, ' ', ''],
  [45, '-', '_'],
  [46, '=', '+'],
  [47, '[', '{'],
  [48, ']', '}'],
  [49, '\\', '|'],
  [51, ';', ':'],
  [52, "'", '"'],
  [53, '`', '~'],
  [54, ',', '<'],
  [55, '.', '>'],
  [56, '/', '?'],
];
const KEY_FOR = new Map<string, { usage: number; shift: boolean }>(
  KEYS.flatMap(([usage, plain, shifted]) => [
    [plain, { usage, shift: false }],
    ...(shifted ? [[shifted, { usage, shift: true }] as const] : []),
  ]),
);

/** HID key strokes for `text` on a US layout, or null when a character has no key (emoji, accents). */
export function textToKeys(text: string) {
  const keys = [...text.replace(/\r\n?/g, '\n')].map((c) => KEY_FOR.get(c));
  return keys.every((k) => k !== undefined) ? keys : null;
}

/** Splits the helper's stdout, `[u32 BE length][JPEG]` repeated, into frames however the chunks fall. */
export function frameSplitter(onFrame: (jpeg: Uint8Array) => void) {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 4) {
      const end = 4 + pending.readUInt32BE(0);
      if (pending.length < end) return;
      onFrame(pending.subarray(4, end));
      pending = pending.subarray(end);
    }
  };
}
