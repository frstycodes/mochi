import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserWindow, desktopCapturer } from 'electron';
import type { AgentImage } from '../../src/host/types/agent.ts';
import type { AppWindow } from '../../src/host/types/windows.ts';
import { nativeHelper } from '../native.ts';
import helperSource from './windows.swift?raw';

const run = promisify(execFile);
// Fits inside, keeping the aspect ratio: Claude resizes images whose long edge passes 1568px.
const CAPTURE_EDGE = 1568;
// Base64 of a 1568px JPEG runs to a few MB.
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Other apps' windows. On macOS through the ScreenCaptureKit helper, which sees every Space: desktopCapturer lists only the
 * current one, so with Mochi in full screen it found nothing. Without the helper (no Xcode in dev, other platforms) desktopCapturer.
 */
export async function listAppWindows(): Promise<AppWindow[]> {
  const helper = await nativeHelper('windows', helperSource);
  if (helper) return JSON.parse((await run(helper, ['list', String(process.pid)], { maxBuffer: MAX_BUFFER })).stdout) as AppWindow[];
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
  return sources.filter((s) => s.name && !own.has(s.id)).map((s) => ({ id: s.id, title: s.name, icon: s.appIcon?.isEmpty() === false ? s.appIcon.resize({ width: 32 }).toDataURL() : undefined }));
}

/** A JPEG of the window `listAppWindows` gave as `id`, or null once it has closed. */
export async function captureAppWindow(id: string): Promise<AgentImage | null> {
  const helper = /^\d+$/.test(id) ? await nativeHelper('windows', helperSource) : null;
  if (helper) {
    const { stdout } = await run(helper, ['capture', id, String(CAPTURE_EDGE)], { maxBuffer: MAX_BUFFER });
    return stdout ? { mediaType: 'image/jpeg', data: stdout } : null;
  }
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: CAPTURE_EDGE, height: CAPTURE_EDGE } });
  const shot = sources.find((s) => s.id === id)?.thumbnail;
  if (!shot || shot.isEmpty()) return null;
  return { mediaType: 'image/jpeg', data: shot.toJPEG(80).toString('base64') };
}
