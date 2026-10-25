import { access, constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../runClient.ts';
import type { Editor } from '@mochi/domain/host/types/fs';

// A GUI-launched app doesn't get the shell's PATH, so the CLI bundled inside each .app is tried before PATH.
const CLIS = {
  vscode: {
    bundle: 'Visual Studio Code.app/Contents/Resources/app/bin/code',
    bin: 'code',
    args: (file: string) => ['-g', file],
  },
  cursor: {
    bundle: 'Cursor.app/Contents/Resources/app/bin/cursor',
    bin: 'cursor',
    args: (file: string) => ['-g', file],
  },
  zed: {
    bundle: 'Zed.app/Contents/MacOS/cli',
    bin: 'zed',
    args: (file: string) => [file],
  },
} satisfies Record<Editor, unknown>;

const LAUNCH_TIMEOUT_MS = 30_000;

export async function installedEditors() {
  const found = await Promise.all(
    (Object.keys(CLIS) as Editor[]).map(async (editor) =>
      (await findCli(editor)) ? [editor] : [],
    ),
  );
  return found.flat();
}

/** Opens the root as the workspace with `file` focused at `line`; an empty `file` opens just the root. */
export async function openInEditor(
  editor: Editor,
  root: string,
  file: string,
  line?: number,
) {
  const cli = await findCli(editor);
  if (!cli) throw new Error(`${editor} is not installed`);
  const target = line ? `${file}:${line}` : file;
  // The editor's CLI hands the request to the running app and exits.
  await runCommand(cli, [root, ...(file ? CLIS[editor].args(target) : [])], {
    timeout: LAUNCH_TIMEOUT_MS,
  });
}

async function findCli(editor: Editor) {
  const { bundle, bin } = CLIS[editor];
  const apps = ['/Applications', path.join(os.homedir(), 'Applications')].map(
    (dir) => path.join(dir, bundle),
  );
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, bin));
  for (const candidate of [...apps, ...onPath]) {
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return null;
}
