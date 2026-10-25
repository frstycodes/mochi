import { app } from 'electron';
import { spawnCommand, type CoreChild } from '@mochi/core/runClient';
import { nativeHelper } from '../native.ts';
import helperSource from './haptic.swift?raw';

let helper: Promise<CoreChild | null> | undefined;

/** One trackpad tick. Best effort: no Xcode to compile the helper, or no Force Touch trackpad, means no haptic. */
export function playHaptic() {
  if (process.platform !== 'darwin') return;
  helper ??= start();
  void helper.then((child) => child?.stdin.write('\n'));
}

async function start() {
  const binary = await nativeHelper('haptic', helperSource);
  if (!binary) return null;
  const child = spawnCommand(binary);
  child.on('exit', () => (helper = undefined));
  app.on('will-quit', () => child.kill());
  return child;
}
