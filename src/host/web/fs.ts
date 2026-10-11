import type { FsHost } from '../types/fs.ts';

export const fs: FsHost = {
  async readDir(path) {
    const join = (name: string) => `${path.replace(/\/$/, '')}/${name}`;
    return [
      { name: 'src', path: join('src'), kind: 'dir' },
      { name: 'package.json', path: join('package.json'), kind: 'file' },
      { name: 'README.md', path: join('README.md'), kind: 'file' },
    ];
  },
  async readFile(path) {
    return `// ${path}\n// Web preview: file contents are only available in the desktop app.\n`;
  },
};
