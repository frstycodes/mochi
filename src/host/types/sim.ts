import type { Manifest } from './manifest.ts';

export interface Simulator {
  udid: string;
  name: string;
  runtime: string;
  state: 'Booted' | 'Booting' | 'Shutdown' | 'Shutting Down';
  family: 'iphone' | 'ipad';
}

export type SimButton = 'home' | 'lock' | 'side' | 'siri';
export type SimTouchPhase = 'down' | 'move' | 'up';
export type SimAppearance = 'light' | 'dark';
export const CONTENT_SIZES = [
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
  'extra-extra-large',
  'extra-extra-extra-large',
  'accessibility-medium',
  'accessibility-large',
  'accessibility-extra-large',
  'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
] as const;
export type SimContentSize = (typeof CONTENT_SIZES)[number];

export interface SimFrame {
  udid: string;
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/svg+xml';
}

export interface SimLogLine {
  udid: string;
  text: string;
}

export interface SimHost {
  list(): Promise<Simulator[]>;
  boot(udid: string): Promise<void>;
  shutdown(udid: string): Promise<void>;
  /** Starts pushing `onFrame` for the device; resolves with its screen size in pixels. */
  stream(udid: string): Promise<{ width: number; height: number }>;
  stopStream(udid: string): Promise<void>;
  onFrame(listener: (frame: SimFrame) => void): () => void;
  /** x and y are 0...1 across the screen. */
  touch(
    udid: string,
    phase: SimTouchPhase,
    x: number,
    y: number,
  ): Promise<void>;
  button(udid: string, button: SimButton): Promise<void>;
  type(udid: string, text: string): Promise<void>;
  /** HID usage of a non-printing key (backspace 42, return 40, arrows 79–82). */
  key(udid: string, usage: number): Promise<void>;
  openUrl(udid: string, url: string): Promise<void>;
  appearance(udid: string): Promise<SimAppearance | null>;
  setAppearance(udid: string, appearance: SimAppearance): Promise<void>;
  contentSize(udid: string): Promise<SimContentSize | null>;
  setContentSize(udid: string, size: SimContentSize): Promise<void>;
  /** Saves a PNG and returns its path. */
  screenshot(udid: string): Promise<string>;
  startRecording(udid: string): Promise<void>;
  /** Stops the recording and returns the .mp4 path. */
  stopRecording(udid: string): Promise<string>;
  /** Builds the first scheme of the Xcode project in `cwd`, installs and launches it; logs arrive on `onBuildLog`. */
  buildAndRun(udid: string, cwd: string): Promise<{ bundleId: string }>;
  onBuildLog(listener: (line: SimLogLine) => void): () => void;
}

export const simMethods = {
  list: 'invoke',
  boot: 'invoke',
  shutdown: 'invoke',
  stream: 'invoke',
  stopStream: 'invoke',
  onFrame: 'event',
  touch: 'invoke',
  button: 'invoke',
  type: 'invoke',
  key: 'invoke',
  openUrl: 'invoke',
  appearance: 'invoke',
  setAppearance: 'invoke',
  contentSize: 'invoke',
  setContentSize: 'invoke',
  screenshot: 'invoke',
  startRecording: 'invoke',
  stopRecording: 'invoke',
  buildAndRun: 'invoke',
  onBuildLog: 'event',
} satisfies Manifest<SimHost>;
