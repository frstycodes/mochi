import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isPatternKill } from './processKill.ts';

const KILLS = [
  'pkill -f "cat" -n',
  'pkill node',
  // BSD pkill and pgrep read every argument after the pattern as another pattern: `.` matches every process.
  'pkill -f mochi-guard-test-nonexistent .',
  'pkill foo -n',
  'pkill -f foo -- .',
  'pgrep -f foo . | xargs kill',
  'pgrep foo -n | xargs kill -9',
  'kill $(pgrep -f foo .)',
  '/usr/bin/pkill -9 -f vite',
  'killall Electron',
  'pgrep -f vite | xargs kill',
  'pgrep -f vite | xargs -I{} kill -9 {}',
  'pgrep -f vite | xargs -n 1 kill',
  "ps aux | grep vite | awk '{print $2}' | xargs kill -9",
  'kill $(pgrep -f vite)',
  'kill -9 `pgrep node`',
  'kill -9 $(pidof node)',
  'kill -9 -1',
  'kill -s KILL -1',
  'kill 0',
  'kill -TERM 0',
  'kill -- -4321',
  'kill -9 -4321',
  'sudo pkill -f vite',
  'sudo -u root killall node',
  'echo vite | xargs pkill -f',
  'sh -c "pkill -f vite"',
  "bash -lc 'killall node'",
  'zsh -c "cd x && pkill node"',
  'eval "pkill node"',
  'cd app; pkill -f vite',
  'npm run build && pkill -f vite',
  'false || killall node',
  'FOO=1 pkill node',
  'env FOO=1 pkill node',
  'timeout 5 pkill node',
  'nohup killall node &',
  '(pkill node)',
  'echo done\npkill node',
  'osascript -e \'quit app "Safari"\'',
  'osascript -e \'tell application "Mochi" to quit\'',
];

const SAFE = [
  'kill 12345',
  'kill -9 12345',
  'kill -TERM 12345 12346',
  'kill %1',
  'kill -9 %1',
  'kill $PID',
  'kill -9 "$(cat .pid)"',
  'kill -l',
  'grep pkill src/file.ts',
  'grep -rn "killall" .',
  'echo "pkill -f vite"',
  "echo 'killall node'",
  'git commit -m "fix: guard pkill; killall"',
  'ls # pkill node',
  '# killall node',
  'pgrep -f vite',
  'pgrep -fl node | head',
  'rg "kill 0" src',
  'osascript -e \'display notification "hi"\'',
  'sh -c "echo hi"',
  'pnpm test --filter pkill',
];

test.each(KILLS)('flags: %s', (command) =>
  assert.equal(isPatternKill(command), true),
);
test.each(SAFE)('allows: %s', (command) =>
  assert.equal(isPatternKill(command), false),
);
