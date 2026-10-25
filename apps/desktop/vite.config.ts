import path from 'node:path';
import { defineConfig, lazyPlugins, loadEnv } from 'vite-plus';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import electron from 'vite-plugin-electron/simple';
import { csp } from './scripts/csp.ts';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: lazyPlugins(() => [
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
          // `serve.js` is `mochi serve` (bin/mochi.mjs): the same Core under plain Node.
          entry: [
            'electron/main.ts',
            '../../packages/core/src/core.ts',
            '../../packages/core/src/serve/serve.ts',
          ],
          vite: {
            // Mochi's OAuth app secrets (electron/library/oauthApps.ts), from the gitignored .env.local.
            define: {
              __MOCHI_OAUTH_ENV__: JSON.stringify(
                loadEnv(
                  mode,
                  path.resolve(import.meta.dirname, '../..'),
                  'MOCHI_OAUTH_',
                ),
              ),
            },
            build: {
              rolldownOptions: {
                external: ['node-pty', /^playwright-core(\/|$)/],
              },
            },
          },
        },
        // A sandboxed preload must be CommonJS; `.cjs` keeps it CJS under the package's `"type": "module"`.
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              rolldownOptions: {
                output: { entryFileNames: '[name].cjs' },
              },
            },
          },
        },
      }),
  ]),
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      {
        find: /^shiki$/,
        replacement: path.resolve(import.meta.dirname, 'src/lib/shiki-slim.ts'),
      },
      {
        find: /^shiki\/wasm$/,
        replacement: path.resolve(import.meta.dirname, 'src/lib/no-wasm.ts'),
      },
    ],
  },
}));
