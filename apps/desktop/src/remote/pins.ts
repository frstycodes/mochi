import { useStore } from 'zustand';
import { persistedSlice } from '../lib/uiStorage.ts';
import type { RemotePin } from './merged.ts';

/**
 * This screen's pins on other computers' threads, kept here and never sent: each computer has its own Pinned list. Its own
 * threads' pins stay on the threads (`orbitSlot`, `pinOrder`); these sort among them by key (`mergeThreads`).
 */
const remotePins = persistedSlice<RemotePin[]>('mochi.remote-pins', []);

export const useRemotePins = () => useStore(remotePins, (s) => s.value);

export const getRemotePins = () => remotePins.getState().value;

export const setRemotePins = (pins: RemotePin[]) =>
  remotePins.setState({ value: pins });

/** Pins another computer's thread last in Pinned here, or unpins it; the sidebar leaves out a pin past the last Orbit slot. */
export function toggleRemotePin(id: string) {
  const pins = getRemotePins();
  setRemotePins(
    pins.some((p) => p.id === id)
      ? pins.filter((p) => p.id !== id)
      : [...pins, { id, order: Date.now() }],
  );
}
