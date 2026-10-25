// node-pty 1.1.0's npm tarball ships prebuilds/*/spawn-helper without the exec bit; every pty spawn then fails with `posix_spawnp failed`.
// Fixed here rather than at runtime: a packaged app can run from a read-only location (App Translocation, a mounted dmg).
import { chmodSync, globSync } from 'node:fs';

export default function afterPack({ appOutDir, packager }) {
  const resources = packager.getResourcesDir(appOutDir);
  for (const helper of globSync(
    'app.asar.unpacked/node_modules/node-pty/prebuilds/*/spawn-helper',
    { cwd: resources },
  ))
    chmodSync(`${resources}/${helper}`, 0o755);
}
