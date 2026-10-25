import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Timing budgets: one Electron app at a time, so runs don't compete for the CPU they measure.
export default defineConfig({
  testDir: '.',
  outputDir: path.join(tmpdir(), 'mochi-e2e-results'),
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
});
