import path from 'node:path';
import { defineConfig, lazyPlugins, loadEnv } from 'vite-plus';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import electron from 'vite-plugin-electron/simple';
import { csp } from './scripts/csp.ts';

// Copied from shadcn and AI Elements and kept as published, so an update diffs cleanly.
const VENDORED = ['src/components/ui/**', 'src/components/ai-elements/**'];

export default defineConfig(({ mode }) => ({
  base: './',
  fmt: { singleQuote: true, printWidth: 160 },
  // GAP: format check is off until in-flight branches land; turning it on reformats ~210 files in one commit.
  check: { fmt: false },
  lint: {
    plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'react'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }, './scripts/oxlint/index.ts'],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error', 'eslint/preserve-caught-error': 'error' },
    overrides: [
      {
        files: ['**/*.{ts,tsx}'],
        excludeFiles: VENDORED,
        rules: { 'mochi/require-suppression-reason': 'error', 'mochi/no-low-value-comments': 'error' },
      },
      {
        files: ['src/**', 'electron/**', 'packages/*/src/**', 'infra/*/src/**'],
        excludeFiles: [...VENDORED, '**/*.test.ts'],
        rules: { 'mochi/no-em-dash-copy': 'error' },
      },
      // The React Compiler builds the renderer only; Core's `use*` setters are not hooks.
      { files: ['src/**/*.{ts,tsx}'], rules: { 'react/hooks': 'error', 'mochi/no-hookless-use-function': 'error' } },
    ],
    // `pnpm typecheck` (tsc-rs) is the type check; tsgolint only supplies types to the type-aware rules.
    options: { typeAware: true, typeCheck: false },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'electron/**/*.test.ts', 'infra/**/src/**/*.test.ts'],
    setupFiles: ['scripts/test-env.ts'],
    // `--changed` follows imports only; a dependency bump or a fixture a test reads from disk reruns everything.
    forceRerunTriggers: ['**/package.json', '**/{vitest,vite}.config.*', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '**/fixtures/**'],
    // Suites that spawn Core, git or a fake CLI take seconds; the default is 5s.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  // Tests run the sources as Node would, without the renderer's transforms.
  plugins: lazyPlugins(() => mode === 'test' ? [] : [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    mode === 'artifact' && viteSingleFile(),
    mode === 'electron' && csp(),
    mode === 'electron' &&
      electron({
        // node-pty is a native addon: bundling it breaks its `.node` and spawn-helper lookups.
        // playwright-core resolves its own package.json and reads files beside it at runtime.
        main: {
          entry: ['electron/main.ts', 'packages/core/src/core.ts'],
          vite: {
            // Mochi's OAuth app secrets (electron/library/oauthApps.ts), from the gitignored .env.local.
            define: { __MOCHI_OAUTH_ENV__: JSON.stringify(loadEnv(mode, import.meta.dirname, 'MOCHI_OAUTH_')) },
            build: { rolldownOptions: { external: ['node-pty', '@parcel/watcher', /^playwright-core(\/|$)/] } },
          },
        },
        // A sandboxed preload must be CommonJS; `.cjs` keeps it CJS under the package's `"type": "module"`.
        preload: {
          input: 'electron/preload.ts',
          vite: { build: { rolldownOptions: { output: { entryFileNames: '[name].cjs' } } } },
        },
      }),
  ]),
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      { find: /^shiki$/, replacement: path.resolve(import.meta.dirname, 'src/lib/shiki-slim.ts') },
      {
        find: /^shiki\/wasm$/,
        replacement: path.resolve(import.meta.dirname, 'src/lib/no-wasm.ts'),
      },
    ],
  },
}));
