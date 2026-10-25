import type {
  SimAppearance,
  SimContentSize,
  SimFrame,
  SimHost,
  SimLogLine,
  Simulator,
} from '@mochi/domain/host/types/sim';

const devices: Simulator[] = [
  {
    udid: 'A1B2C3D4-0000-4000-8000-000000000001',
    name: 'iPhone 17 Pro',
    runtime: 'iOS 26.2',
    state: 'Booted',
    family: 'iphone',
  },
  {
    udid: 'A1B2C3D4-0000-4000-8000-000000000003',
    name: 'iPhone 17 Pro Max',
    runtime: 'iOS 26.2',
    state: 'Shutdown',
    family: 'iphone',
  },
  {
    udid: 'A1B2C3D4-0000-4000-8000-000000000002',
    name: 'iPad Air 13-inch (M3)',
    runtime: 'iOS 26.2',
    state: 'Shutdown',
    family: 'ipad',
  },
];
const appearances = new Map<string, SimAppearance>();
const contentSizes = new Map<string, SimContentSize>();
const frameListeners = new Set<(frame: SimFrame) => void>();
const logListeners = new Set<(line: SimLogLine) => void>();
const SIZE = {
  iphone: { width: 1206, height: 2622 },
  ipad: { width: 2064, height: 2752 },
};

// Every call resolves like the desktop host, so the tab renders a believable device in the web build.
export const sim: SimHost = {
  async list() {
    return devices.map((d) => ({ ...d }));
  },
  async boot(udid) {
    setState(udid, 'Booted');
  },
  async shutdown(udid) {
    setState(udid, 'Shutdown');
  },
  async stream(udid) {
    const size = SIZE[device(udid).family];
    queueMicrotask(() => emitFrame(udid));
    return size;
  },
  async stopStream() {},
  onFrame(listener) {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  },
  async touch() {},
  async button() {},
  async type() {},
  async key() {},
  async openUrl() {},
  async appearance(udid) {
    return appearances.get(udid) ?? 'light';
  },
  async setAppearance(udid, appearance) {
    appearances.set(udid, appearance);
    emitFrame(udid);
  },
  async contentSize(udid) {
    return contentSizes.get(udid) ?? 'large';
  },
  async setContentSize(udid, size) {
    contentSizes.set(udid, size);
  },
  async screenshot() {
    return '/tmp/simulator-screenshot.png';
  },
  async startRecording() {},
  async stopRecording() {
    return '/tmp/simulator-recording.mp4';
  },
  async buildAndRun(udid) {
    for (const text of [
      '$ xcodebuild -scheme App build',
      'web preview: no Xcode here',
      '** BUILD SUCCEEDED **',
    ]) {
      logListeners.forEach((l) => l({ udid, text }));
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return { bundleId: 'com.example.app' };
  },
  onBuildLog(listener) {
    logListeners.add(listener);
    return () => logListeners.delete(listener);
  },
};

function device(udid: string) {
  const found = devices.find((d) => d.udid === udid);
  if (!found) throw new Error(`no device ${udid}`);
  return found;
}

function setState(udid: string, state: Simulator['state']) {
  device(udid).state = state;
}

function emitFrame(udid: string) {
  const { width, height } = SIZE[device(udid).family];
  const data = new TextEncoder().encode(
    mockScreen(width, height, appearances.get(udid) ?? 'light'),
  );
  frameListeners.forEach((listener) =>
    listener({ udid, data, mime: 'image/svg+xml' }),
  );
}

/** A home screen sketch: wallpaper, a 4-column icon grid and a dock. */
function mockScreen(width: number, height: number, appearance: SimAppearance) {
  const isDark = appearance === 'dark';
  const icon = Math.min(width, height * 0.46) / 6.2;
  const gap = (width - icon * 4) / 5;
  const icons = Array.from({ length: 16 }, (_, i) => {
    const x = gap + (i % 4) * (icon + gap);
    const y = height * 0.09 + Math.floor(i / 4) * icon * 1.5;
    return `<rect x="${x}" y="${y}" width="${icon}" height="${icon}" rx="${icon * 0.23}" fill="hsl(${(i * 37) % 360} 55% ${isDark ? 45 : 62}%)"/>`;
  }).join('');
  const dockY = height - icon * 1.9;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${isDark ? '#1c2235' : '#c9d6f2'}"/><stop offset="1" stop-color="${isDark ? '#3a2340' : '#f2d4e4'}"/></linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#w)"/>${icons}
<rect x="${gap / 2}" y="${dockY}" width="${width - gap}" height="${icon * 1.5}" rx="${icon * 0.45}" fill="${isDark ? '#ffffff22' : '#ffffff66'}"/>
</svg>`;
}
