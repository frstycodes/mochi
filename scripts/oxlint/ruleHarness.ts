// T3 Code's oxlint-plugin-t3code/test/utils.ts `createOxlintRuleHarness`, rewritten on spawnSync: the same valid/invalid API, so
// its rule tests vendor unchanged.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, it, onTestFinished } from 'vite-plus/test';

// oxlint comes through vite-plus, so resolve it from there.
const oxlint = join(dirname(createRequire(createRequire(import.meta.url).resolve('vite-plus/package.json')).resolve('oxlint/package.json')), 'bin/oxlint');
const plugin = fileURLToPath(new URL('./index.ts', import.meta.url));

export function createOxlintRuleHarness(ruleName: string, options: { filename?: string; ruleOptions?: readonly unknown[] } = {}) {
  const [pluginName, shortName] = ruleName.split('/');
  const diagnostic = new RegExp(`${pluginName}\\(${shortName}\\)`);

  function run(source: string) {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-oxlint-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, '.oxlintrc.json'), JSON.stringify({ jsPlugins: [plugin], rules: { [ruleName]: ['error', ...(options.ruleOptions ?? [])] } }));
    writeFileSync(join(dir, options.filename ?? 'fixture.ts'), source);
    const { status, stdout, stderr } = spawnSync(process.execPath, [oxlint, '-c', '.oxlintrc.json', options.filename ?? 'fixture.ts'], { cwd: dir, encoding: 'utf8' });
    return { isFailure: status !== 0, output: `${stdout}${stderr}` };
  }

  return {
    valid(name: string, source: string) {
      it(name, () => {
        const { isFailure, output } = run(source);
        assert.isFalse(isFailure, output);
      });
    },
    invalid(name: string, source: string, assertion?: (output: string) => void) {
      it(name, () => {
        const { isFailure, output } = run(source);
        assert.isTrue(isFailure, `expected ${ruleName} to report`);
        assert.match(output, diagnostic);
        assertion?.(output);
      });
    },
  };
}
