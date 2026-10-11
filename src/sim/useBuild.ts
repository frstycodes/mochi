import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { host } from '@/host';
import { message } from './useSimulators';

const MAX_LINES = 500;

/** Build & run state for one device: streamed log lines and whether a build is in flight. */
export function useBuild(udid: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [isBuilding, setBuilding] = useState(false);

  useEffect(() => host.sim.onBuildLog((line) => line.udid === udid && setLines((prev) => [...prev, line.text].slice(-MAX_LINES))), [udid]);

  const run = async (cwd: string) => {
    if (!udid || isBuilding) return;
    setLines([]);
    setBuilding(true);
    try {
      const { bundleId } = await host.sim.buildAndRun(udid, cwd);
      toast.success(`Launched ${bundleId}`);
    } catch (e) {
      setLines((prev) => [...prev, message(e)]);
      toast.error('Build failed', { description: message(e) });
    } finally {
      setBuilding(false);
    }
  };

  return { lines, isBuilding, run, clear: () => setLines([]) };
}
