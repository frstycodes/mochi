import type { FileContent, FsChange, FsHost } from '../types/fs.ts';

// In-memory files so the web build can show the tree, editor and previews; every root sees the same set.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3987e5"/><path d="M20 20v24M44 20v24M20 32h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>\n`;

const files = new Map<string, { text: string; mtimeMs: number }>(
  Object.entries({
    'README.md': '# Harness\n\nA calm workspace for running many coding agents at once.\n\n- **Threads** with goals and steps\n- A side pane with `Preview`, `Changes`, `Terminal` and `Files`\n\n```ts\nexport const answer = 42;\n```\n',
    'package.json': '{\n  "name": "harness-proto",\n  "private": true,\n  "scripts": { "dev": "vite", "test": "node --test" },\n  "dependencies": { "react": "^19.3.0" }\n}\n',
    'src/App.tsx': "import { useState } from 'react';\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>;\n}\n",
    'src/index.css': ':root {\n  --background: oklch(0.975 0.003 285);\n}\n\nbody {\n  background: var(--background);\n}\n',
    'src/logo.svg': LOGO_SVG,
    'scripts/build.py': 'import sys\n\n\ndef main() -> int:\n    print("building", sys.argv[1:])\n    return 0\n',
  }).map(([path, text]) => [path, { text, mtimeMs: 1 }]),
);
const listeners = new Set<(change: FsChange) => void>();

export const fs: FsHost = {
  async list() {
    return [...files.keys()].sort();
  },
  async read(_root, path): Promise<FileContent> {
    const file = files.get(path);
    if (!file) throw new Error(`${path} does not exist`);
    return { kind: 'text', ...file };
  },
  async write(root, path, text, { baseMtimeMs, force }) {
    const file = files.get(path);
    if (!file) throw new Error(`${path} does not exist`);
    if (!force && file.mtimeMs !== baseMtimeMs) return { status: 'conflict', ...file };
    const mtimeMs = file.mtimeMs + 1;
    files.set(path, { text, mtimeMs });
    listeners.forEach((l) => l({ root, path }));
    return { status: 'saved', mtimeMs };
  },
  async watch() {},
  async unwatch() {},
  onChange(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  async editors() {
    return [];
  },
  async openIn() {},
};
