// .github/workflows/release.yml: `version <channel>` prints the release version once; `build <channel> <version>`, on each
// OS, stamps it into package.json and packages installers plus electron-updater's feed files into `release/`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

type Channel = 'stable' | 'nightly';

/**
 * Stable is the `v<version>` tag, which must match package.json. Nightly is package.json's version (the next stable,
 * bumped right after each stable tag) plus `-nightly.<yyyymmdd>.<run>`, so nightlies sort above the last stable and by date.
 */
export function releaseVersion(
  channel: Channel,
  {
    version,
    tag,
    date,
    run,
  }: { version: string; tag?: string; date: Date; run: string },
) {
  if (channel === 'stable') {
    if (tag !== `v${version}`)
      throw new Error(
        `Tag ${tag ?? '(none)'} doesn't match package.json's version ${version}; tag v${version} or bump it`,
      );
    return version;
  }
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `${version}-nightly.${day}.${run}`;
}

const readPackage = () => JSON.parse(readFileSync('package.json', 'utf8'));

function build(channel: Channel, version: string) {
  const pkg = readPackage();
  pkg.version = version;
  pkg.build.publish.channel = channel === 'nightly' ? 'nightly' : 'latest';
  // package.json turns signing off for local builds; a release signs and notarizes once the Apple secrets exist.
  // GAP: without CSC_LINK the macOS build is unsigned, and Squirrel.Mac won't install updates into an unsigned app.
  if (process.env.CSC_LINK) {
    delete pkg.build.mac.identity;
    pkg.build.mac.notarize = true;
  }
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { stdio: 'inherit' });
  run('pnpm', ['exec', 'vp', 'build', '--mode', 'electron']);
  run('node', ['scripts/build-native.mjs']);
  // Both Mac architectures in one run, so electron-builder writes one feed file listing both.
  const archs = process.platform === 'darwin' ? ['--arm64', '--x64'] : [];
  run('pnpm', ['exec', 'electron-builder', '--publish', 'never', ...archs]);
}

const [, script, command, channel, version] = process.argv;
if (script && import.meta.filename === script) {
  if (channel !== 'stable' && channel !== 'nightly')
    throw new Error(
      'Usage: node scripts/release.ts <version|build> <stable|nightly> [version]',
    );
  if (command === 'version')
    console.log(
      releaseVersion(channel, {
        version: readPackage().version,
        tag: process.env.GITHUB_REF_NAME,
        date: new Date(),
        run: process.env.GITHUB_RUN_NUMBER ?? '0',
      }),
    );
  else if (command === 'build' && version) build(channel, version);
  else throw new Error(`Unknown command ${command}`);
}
