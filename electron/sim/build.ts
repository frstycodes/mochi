import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { bundleId } from './parse.ts';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

interface BuildSettings {
  buildSettings: Record<string, string | undefined>;
}

/** Builds the first scheme of the project in `cwd` for the simulator, installs and launches it. */
export async function buildAndRun(udid: string, cwd: string, log: (text: string) => void) {
  const dir = path.resolve(cwd);
  if (!(await stat(dir)).isDirectory()) throw new Error(`${dir} is not a folder`);
  const entries = await readdir(dir);
  // GAP: Swift packages (Package.swift without a project) and nested projects aren't found yet.
  const container = entries.find((e) => e.endsWith('.xcworkspace')) ?? entries.find((e) => e.endsWith('.xcodeproj'));
  if (!container) throw new Error(`No .xcodeproj or .xcworkspace in ${dir}`);
  const flag = container.endsWith('.xcworkspace') ? '-workspace' : '-project';

  log(`$ xcodebuild -list ${flag} ${container}`);
  const list = JSON.parse((await run('xcodebuild', ['-list', '-json', flag, container], { cwd: dir, maxBuffer: MAX_BUFFER })).stdout);
  const scheme: string | undefined = (list.workspace ?? list.project)?.schemes?.[0];
  if (!scheme) throw new Error(`${container} has no schemes`);

  const derivedData = path.join(app.getPath('userData'), 'simulator', 'DerivedData', createHash('sha256').update(dir).digest('hex').slice(0, 12));
  const args = [flag, container, '-scheme', scheme, '-destination', `id=${udid}`, '-derivedDataPath', derivedData];
  log(`$ xcodebuild ${args.join(' ')} build`);
  await streamed('xcodebuild', [...args, 'build'], dir, log);

  const settings: BuildSettings[] = JSON.parse((await run('xcodebuild', [...args, '-showBuildSettings', '-json'], { cwd: dir, maxBuffer: MAX_BUFFER })).stdout);
  const target = settings.map((s) => s.buildSettings).find((s) => s.WRAPPER_NAME?.endsWith('.app'));
  if (!target?.TARGET_BUILD_DIR || !target.WRAPPER_NAME) throw new Error(`Scheme ${scheme} doesn't build an app`);
  const appPath = path.join(target.TARGET_BUILD_DIR, target.WRAPPER_NAME);
  const id = bundleId(target.PRODUCT_BUNDLE_IDENTIFIER);

  log(`$ xcrun simctl install ${udid} ${appPath}`);
  await run('xcrun', ['simctl', 'install', udid, appPath]);
  log(`$ xcrun simctl launch ${udid} ${id}`);
  await run('xcrun', ['simctl', 'launch', udid, id]);
  log(`Launched ${id}`);
  return { bundleId: id };
}

/** execFile with output delivered line by line instead of buffered until exit. */
function streamed(file: string, args: string[], cwd: string, log: (text: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { cwd });
    let partial = '';
    const onData = (text: string) => {
      const lines = (partial + text).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) log(line);
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (partial) log(partial);
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with ${code}`));
    });
  });
}
