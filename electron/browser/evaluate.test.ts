import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVAL_MAX_CHARS, evalResult, withTimeout } from './evaluate.ts';

test('evalResult returns the last value as JSON and says when it cut it', () => {
  assert.deepEqual(evalResult({ result: { type: 'object', value: { count: 3 } } }), { value: '{"count":3}', isTruncated: false });
  assert.deepEqual(evalResult({ result: { type: 'undefined' } }), { value: 'undefined', isTruncated: false });
  assert.deepEqual(evalResult({ result: { type: 'number', unserializableValue: 'NaN' } }), { value: 'NaN', isTruncated: false });
  const long = evalResult({ result: { type: 'string', value: 'x'.repeat(EVAL_MAX_CHARS * 2) } });
  assert.equal(long.isTruncated, true);
  assert.equal(long.value.length, EVAL_MAX_CHARS);
});

test('evalResult throws the page error with only the first lines of its stack', () => {
  const description = ['TypeError: x is undefined', '    at a (page.js:1:1)', '    at b (page.js:2:1)', '    at c (page.js:3:1)', '    at d (page.js:4:1)', '    at e (page.js:5:1)'].join('\n');
  assert.throws(() => evalResult({ exceptionDetails: { exception: { description } } }), (e: Error) => e.message.split('\n').length === 4 && e.message.startsWith('TypeError: x is undefined'));
});

test('withTimeout gives up on a script that never settles', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20), /ran past 0.02s/);
  assert.equal(await withTimeout(Promise.resolve('done'), 20), 'done');
});
