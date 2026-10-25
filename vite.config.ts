import path from 'node:path';
import { defineConfig } from 'vite-plus';
import { COMPLEX_FILES } from './scripts/oxlint/complexity-burndown.ts';

// Copied from shadcn and AI Elements and kept as published, so an update diffs cleanly.
const VENDORED = [
  'apps/desktop/src/components/ui/**',
  'apps/desktop/src/components/ai-elements/**',
];

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: 'vp test run',
        // pnpm rewrites .modules.yaml on install and coverage writes ./coverage; neither is a test input.
        cache: {
          input: [
            { auto: true },
            '!node_modules/.modules.yaml',
            '!node_modules/.vite/**',
            '!coverage',
            '!coverage/**',
          ],
        },
      },
      tsc: {
        command:
          'tsc -b apps/desktop && tsc -p apps/desktop/electron && tsc -p packages/domain && tsc -p packages/core && tsc -p infra/relay',
        // `tsc -b` rewrites its own .tsbuildinfo, which would otherwise count as a changed input.
        cache: { input: [{ auto: true }, '!**/*.tsbuildinfo'] },
      },
    },
  },
  staged: { '*.{js,mjs,ts,tsx,json,css,md}': 'vp check --fix' },
  fmt: {
    singleQuote: true,
    printWidth: 80,
    ignorePatterns: [...VENDORED, '**/fixtures/**', '.claude/**'],
  },
  lint: {
    plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'react'],
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      './scripts/oxlint/index.ts',
      'eslint-plugin-sonarjs',
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'eslint/preserve-caught-error': 'error',
    },
    overrides: [
      {
        files: ['**/*.{ts,tsx}'],
        excludeFiles: VENDORED,
        rules: {
          'mochi/require-suppression-reason': 'error',
          'mochi/no-low-value-comments': 'error',
          // SonarSource's default limit.
          'sonarjs/cognitive-complexity': ['error', 15],
        },
      },
      {
        files: COMPLEX_FILES,
        rules: { 'sonarjs/cognitive-complexity': ['warn', 15] },
      },
      // Vendored from T3 Code; kept close to upstream.
      {
        files: ['scripts/oxlint/rules/*.ts'],
        excludeFiles: ['**/*.test.ts'],
        rules: { 'sonarjs/cognitive-complexity': 'off' },
      },
      {
        files: [
          'apps/*/src/**',
          'apps/*/electron/**',
          'packages/*/src/**',
          'infra/*/src/**',
        ],
        excludeFiles: [...VENDORED, '**/*.test.ts'],
        rules: { 'mochi/no-em-dash-copy': 'error' },
      },
      {
        files: ['**/*.test.ts'],
        rules: {
          'mochi/no-manual-effect-runtime-in-tests': 'error',
          'mochi/no-polling-loop-in-tests': 'error',
          'mochi/no-real-time-wait-in-tests': 'error',
          'mochi/no-test-in-loop': 'error',
          'mochi/no-wall-clock-in-tests': 'error',
        },
      },
      // The React Compiler builds the renderer only; Core's `use*` setters are not hooks.
      {
        files: ['apps/desktop/src/**/*.{ts,tsx}'],
        excludeFiles: VENDORED,
        rules: {
          'react/hooks': 'error',
          'mochi/no-hookless-use-function': 'error',
          'react/refs': 'error',
          'react/set-state-in-effect': 'error',
          'react/purity': 'error',
          'react/immutability': 'error',
          'react/static-components': 'error',
          'react/preserve-manual-memoization': 'error',
          'react/exhaustive-effect-dependencies': 'error',
          'mochi/no-manual-memo': 'error',
        },
      },
    ],
    // `pnpm typecheck` (tsc-rs) is the type check; tsgolint only supplies types to the type-aware rules.
    options: { typeAware: true, typeCheck: false },
  },
  test: {
    include: [
      'apps/*/src/**/*.test.ts',
      'apps/*/scripts/**/*.test.ts',
      'apps/*/electron/**/*.test.ts',
      'scripts/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'infra/**/src/**/*.test.ts',
    ],
    setupFiles: ['scripts/test-env.ts'],
    // `--changed` follows imports only; a dependency bump or a fixture a test reads from disk reruns everything.
    coverage: { provider: 'v8', reporter: ['text-summary', 'json-summary'] },
    forceRerunTriggers: [
      '**/package.json',
      '**/{vitest,vite}.config.*',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '**/fixtures/**',
    ],
    // Suites that spawn Core, git or a fake CLI take seconds; the default is 5s.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  // Tests run the sources as Node would, without the renderer's transforms; the renderer's aliases still apply.
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(import.meta.dirname, 'apps/desktop/src'),
      },
      {
        find: /^shiki$/,
        replacement: path.resolve(
          import.meta.dirname,
          'apps/desktop/src/lib/shiki-slim.ts',
        ),
      },
      {
        find: /^shiki\/wasm$/,
        replacement: path.resolve(
          import.meta.dirname,
          'apps/desktop/src/lib/no-wasm.ts',
        ),
      },
    ],
  },
});
