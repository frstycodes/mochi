import { useEffect, useState } from 'react';
import { host } from '@/host';
import { message } from './useSimulators';

interface StreamState {
  frameUrl: string | null;
  size: { width: number; height: number } | null;
  error: string | null;
}

const IDLE: StreamState = { frameUrl: null, size: null, error: null };

/** Latest screen frame of a booted simulator as an object URL; null `udid` streams nothing. */
export function useSimStream(udid: string | null) {
  const [state, setState] = useState<StreamState>(IDLE);
  const [streamed, setStreamed] = useState(udid);
  if (streamed !== udid) {
    setStreamed(udid);
    setState(IDLE);
  }

  useEffect(() => {
    if (!udid) return;
    let isLive = true;
    let current: string | null = null;
    const off = host.sim.onFrame((frame) => {
      if (frame.udid !== udid || !isLive) return;
      const next = URL.createObjectURL(
        new Blob([frame.data as Uint8Array<ArrayBuffer>], { type: frame.mime }),
      );
      if (current) URL.revokeObjectURL(current);
      current = next;
      setState((s) => ({ ...s, frameUrl: next }));
    });
    host.sim.stream(udid).then(
      (size) => isLive && setState((s) => ({ ...s, size })),
      (e) => isLive && setState((s) => ({ ...s, error: message(e) })),
    );
    return () => {
      isLive = false;
      off();
      host.sim.stopStream(udid);
      if (current) URL.revokeObjectURL(current);
    };
  }, [udid]);

  return udid ? state : IDLE;
}
