import { app } from 'electron';
import type { Capabilities } from '@mochi/schema';

/** `app.getAppMetrics()` for the developer page: one entry per Electron process (main, renderers, GPU, utility). A field Electron leaves out is left out here too: the JSON codec turns `undefined` into `null`. */
export function processMetrics(): Capabilities.ProcessMetric[] {
  return app.getAppMetrics().map((process) => {
    const name = process.name || process.serviceName;
    return {
      pid: process.pid,
      type: process.type,
      ...(name ? { name } : {}),
      cpuPercent: process.cpu.percentCPUUsage,
      cpuSeconds: process.cpu.cumulativeCPUUsage ?? 0,
      workingSetKb: process.memory.workingSetSize,
      ...(process.memory.privateBytes === undefined ? {} : { privateKb: process.memory.privateBytes }),
    };
  });
}
