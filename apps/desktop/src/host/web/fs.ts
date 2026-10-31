import { joinPath } from '../../chat/fileMentions.ts';
import { compileQuery, matchLines } from '@mochi/domain/files/search';
import type {
  FileContent,
  FsHost,
  SearchHits,
} from '@mochi/domain/host/types/fs';

// In-memory files so the web build can show the tree, editor and previews; every root sees the same set.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3987e5"/><path d="M20 20v24M44 20v24M20 32h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>\n`;

const files = new Map<string, { text: string; mtimeMs: number }>(
  Object.entries({
    'README.md':
      '# Mochi\n\nA calm workspace for running many coding agents at once.\n\n- **Threads** with steps\n- A side pane with `Preview`, `Changes`, `Terminal` and `Files`\n\n```ts\nexport const answer = 42;\n```\n',
    'package.json':
      '{\n  "name": "harness-proto",\n  "private": true,\n  "scripts": { "dev": "vite", "test": "node --test" },\n  "dependencies": { "react": "^19.3.0" }\n}\n',
    'src/App.tsx':
      "import { useState } from 'react';\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>;\n}\n",
    'src/SidePane.tsx':
      'export function SidePane() {\n  return <aside>Preview, Changes, Terminal and Files</aside>;\n}\n',
    'src/index.css':
      ':root {\n  --background: oklch(0.975 0.003 285);\n}\n\nbody {\n  background: var(--background);\n}\n',
    'src/logo.svg': LOGO_SVG,
    'scripts/build.py':
      'import sys\n\n\ndef main() -> int:\n    print("building", sys.argv[1:])\n    return 0\n',
  }).map(([path, text]) => [path, { text, mtimeMs: 1 }]),
);
// A few files outside the fixture project, so `@../` and `@~/` have something to browse.
const OUTSIDE_FILES: Record<string, string[]> = {
  '~': ['notes.md'],
  '~/dev/liane': ['README.md', 'package.json'],
};
// Where the fixture project (root `.`) sits in the fixture tree.
const WEB_PROJECT = '~/dev/harness';
const hitListeners = new Set<(hits: SearchHits) => void>();
const SEARCH_LIMIT = 2_000;

const FOLDERS: Record<string, string[]> = {
  '~': ['dev', 'work', 'Documents'],
  '~/dev': ['agent-skills', 'focus-mode', 'harness', 'liane', 'map-veto'],
  '~/work': ['latitude', 'latitude-docs', 'latitude-infra'],
  '~/Documents': ['notes'],
};

export const fs: FsHost = {
  async list() {
    return [...files.keys()].sort();
  },
  async read(_root, path): Promise<FileContent> {
    const file = files.get(path);
    if (!file) throw new Error(`${path} does not exist`);
    return { kind: 'text', ...file };
  },
  async write(_root, path, text, { baseMtimeMs, force }) {
    const file = files.get(path);
    if (!file) throw new Error(`${path} does not exist`);
    if (!force && file.mtimeMs !== baseMtimeMs)
      return { status: 'conflict', ...file };
    const mtimeMs = file.mtimeMs + 1;
    files.set(path, { text, mtimeMs });
    return { status: 'saved', mtimeMs };
  },
  async search(_root, id, pattern, options) {
    const regex = compileQuery(pattern, options);
    for (const [path, { text }] of [...files].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const lines = matchLines(text, regex, SEARCH_LIMIT);
      if (lines.length) hitListeners.forEach((l) => l({ id, path, lines }));
    }
    return { isTruncated: false };
  },
  async cancelSearch() {},
  onSearchHits(listener) {
    hitListeners.add(listener);
    return () => void hitListeners.delete(listener);
  },
  async editors() {
    return [];
  },
  async openIn() {},
  async reveal() {
    throw new Error('Revealing files needs the desktop app');
  },
  // A browser can't list folders: a fixed tree, so Open folder's suggestions and Tab completion can be tried.
  async folders(path) {
    const full = path.replace(/\/+$/, '') || '~';
    const parent = full.slice(0, full.lastIndexOf('/'));
    if (FOLDERS[full]) return { path: full, names: FOLDERS[full] };
    return FOLDERS[parent]?.includes(full.slice(full.lastIndexOf('/') + 1))
      ? { path: full, names: [] }
      : null;
  },
  async entries(at) {
    const full = at.startsWith('~')
      ? joinPath('~', `.${at.slice(1)}`)
      : joinPath(WEB_PROJECT, at);
    if (full === WEB_PROJECT) {
      const top = [...files.keys()].map((f) => f.split('/'));
      return {
        path: full,
        dirs: [
          ...new Set(top.filter((p) => p.length > 1).map((p) => p[0])),
        ].sort(),
        files: top
          .filter((p) => p.length === 1)
          .map((p) => p[0])
          .sort(),
      };
    }
    if (!FOLDERS[full] && !OUTSIDE_FILES[full]) return null;
    return {
      path: full,
      dirs: FOLDERS[full] ?? [],
      files: OUTSIDE_FILES[full] ?? [],
    };
  },
  // GAP: the File System Access API never exposes a path, only the folder's name.
  async pickFolder() {
    const picker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<{ name: string }>;
      }
    ).showDirectoryPicker;
    if (!picker)
      throw new Error(
        'This browser has no folder picker. Type the path instead.',
      );
    try {
      return (await picker()).name;
    } catch {
      return null;
    }
  },
};
