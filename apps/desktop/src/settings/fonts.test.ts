import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { fontStack, isMissingFont } from './fonts.ts';

test('a picked family leads the stack and falls back to the default', () => {
  assert.equal(
    fontStack('mono', 'JetBrains Mono'),
    `"JetBrains Mono", ui-monospace, 'SF Mono', Menlo, monospace`,
  );
  assert.equal(
    fontStack('mono', ''),
    "ui-monospace, 'SF Mono', Menlo, monospace",
  );
});

test('quotes in a typed family cannot break out of the stack', () => {
  assert.equal(
    fontStack('ui', 'Evil", serif; x: "'),
    `"Evil, serif; x: ", 'Inter Variable', system-ui, -apple-system, sans-serif`,
  );
});

test('a family is missing only when the list is known and lacks it', () => {
  const fonts = [{ family: 'Menlo', isMono: true }];
  assert.equal(isMissingFont('menlo', fonts), false);
  assert.equal(isMissingFont('Berkeley Mono', fonts), true);
  assert.equal(isMissingFont('Berkeley Mono', null), false);
  assert.equal(isMissingFont('Berkeley Mono', undefined), false);
  assert.equal(isMissingFont('', fonts), false);
});
