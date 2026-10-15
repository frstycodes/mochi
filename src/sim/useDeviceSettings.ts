import { useEffect, useState } from 'react';
import { toast } from '@/toast/store';
import { host } from '@/host';
import type { SimAppearance, SimContentSize } from '@/host/types/sim';
import { message } from './useSimulators';

/** Appearance and Dynamic Type of a booted device, read on mount and written optimistically. */
export function useDeviceSettings(udid: string | null) {
  const [appearance, setAppearanceState] = useState<SimAppearance | null>(null);
  const [contentSize, setContentSizeState] = useState<SimContentSize | null>(null);

  useEffect(() => {
    if (!udid) return;
    let isLive = true;
    host.sim.appearance(udid).then((value) => isLive && setAppearanceState(value), () => {});
    host.sim.contentSize(udid).then((value) => isLive && setContentSizeState(value), () => {});
    return () => {
      isLive = false;
    };
  }, [udid]);

  const setAppearance = (value: SimAppearance) => {
    if (!udid) return;
    setAppearanceState(value);
    host.sim.setAppearance(udid, value).catch((e) => toast.error(message(e)));
  };
  const setContentSize = (value: SimContentSize) => {
    if (!udid) return;
    setContentSizeState(value);
    host.sim.setContentSize(udid, value).catch((e) => toast.error(message(e)));
  };

  return { appearance, contentSize, setAppearance, setContentSize };
}
