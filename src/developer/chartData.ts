import type { MetricsSnapshot } from '@mochi/core/metrics/schema';

/** One point of the CPU chart: every process together, and the GPU process alone, which the blur work is measured on. */
export function cpuSeries(history: ReadonlyArray<MetricsSnapshot>) {
  return history.map((sample) => ({
    at: sample.at,
    total: sum(sample.processes.map((p) => p.cpuPercent)),
    gpu: sum(
      sample.processes.filter((p) => p.type === 'GPU').map((p) => p.cpuPercent),
    ),
  }));
}

/** The GPU process's cumulative CPU seconds; two readings give its rate without Electron's sampling window. */
export const gpuSeconds = (sample: MetricsSnapshot | undefined) =>
  sum(
    (sample?.processes ?? [])
      .filter((p) => p.type === 'GPU')
      .map((p) => p.cpuSeconds),
  );

const sum = (values: ReadonlyArray<number>) =>
  values.reduce((a, b) => a + b, 0);
