import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { toast } from '@/toast/store';
import { host } from '@/host';
import type { SimAppearance, SimContentSize } from '@/host/types/sim';
import { message } from './useSimulators';

/** Appearance and Dynamic Type of a booted device, read on mount and written optimistically. */
export function useDeviceSettings(udid: string | null) {
  const appearanceQuery = useQuery({ queryKey: queryKeys.sim.appearance(udid), queryFn: () => host.sim.appearance(udid!), enabled: !!udid });
  const sizeQuery = useQuery({ queryKey: queryKeys.sim.contentSize(udid), queryFn: () => host.sim.contentSize(udid!), enabled: !!udid });
  const appearance = appearanceQuery.data ?? null;
  const contentSize = sizeQuery.data ?? null;
  const setAppearance = (value: SimAppearance) => {
    if (!udid) return;
    queryClient.setQueryData(queryKeys.sim.appearance(udid), value);
    host.sim.setAppearance(udid, value).finally(() => queryClient.invalidateQueries({ queryKey: queryKeys.sim.appearance(udid) })).catch((e) => toast.error(message(e)));
  };
  const setContentSize = (value: SimContentSize) => {
    if (!udid) return;
    queryClient.setQueryData(queryKeys.sim.contentSize(udid), value);
    host.sim.setContentSize(udid, value).finally(() => queryClient.invalidateQueries({ queryKey: queryKeys.sim.contentSize(udid) })).catch((e) => toast.error(message(e)));
  };

  return { appearance, contentSize, setAppearance, setContentSize };
}
