import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import electron from 'vite-plugin-electron/simple';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    mode === 'electron' &&
      electron({
        main: { entry: 'electron/main.ts' },
        // A sandboxed preload must be CommonJS; `.cjs` keeps it CJS under the package's `"type": "module"`.
        preload: { input: 'electron/preload.ts', vite: { build: { rolldownOptions: { output: { entryFileNames: '[name].cjs' } } } } },
      }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      { find: /^shiki$/, replacement: path.resolve(import.meta.dirname, 'src/lib/shiki-slim.ts') },
      { find: /^shiki\/wasm$/, replacement: path.resolve(import.meta.dirname, 'src/lib/no-wasm.ts') },
    ],
  },
}));
