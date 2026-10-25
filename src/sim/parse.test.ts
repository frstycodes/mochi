import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  frameSplitter,
  parseSimctlList,
  textToKeys,
  udid,
  url,
} from '../../electron/sim/parse.ts';

const LIST = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
      {
        udid: '150487AB-81EB-4EE2-96F6-996AD50F908D',
        name: 'iPhone 17 Pro',
        state: 'Shutdown',
        isAvailable: true,
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
      },
      {
        udid: 'F3116EBA-E806-42CC-970D-58E6FD822961',
        name: 'iPad Pro 13-inch (M5)',
        state: 'Booted',
        isAvailable: true,
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5',
      },
      {
        udid: '00000000-0000-0000-0000-000000000001',
        name: 'Broken',
        state: 'Shutdown',
        isAvailable: false,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
      },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      {
        udid: '0FDED2A8-7B01-4F94-AF79-1F479DF59789',
        name: 'iPhone 18 Pro',
        state: 'Shutdown',
        isAvailable: true,
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
      },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [
      {
        udid: '00000000-0000-0000-0000-000000000002',
        name: 'Apple Watch',
        state: 'Booted',
        isAvailable: true,
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-11',
      },
    ],
  },
});

test('parseSimctlList keeps available iPhones and iPads, booted first, newest runtime next', () => {
  assert.deepEqual(parseSimctlList(LIST), [
    {
      udid: 'F3116EBA-E806-42CC-970D-58E6FD822961',
      name: 'iPad Pro 13-inch (M5)',
      runtime: 'iOS 26.2',
      state: 'Booted',
      family: 'ipad',
    },
    {
      udid: '0FDED2A8-7B01-4F94-AF79-1F479DF59789',
      name: 'iPhone 18 Pro',
      runtime: 'iOS 27.0',
      state: 'Shutdown',
      family: 'iphone',
    },
    {
      udid: '150487AB-81EB-4EE2-96F6-996AD50F908D',
      name: 'iPhone 17 Pro',
      runtime: 'iOS 26.2',
      state: 'Shutdown',
      family: 'iphone',
    },
  ]);
});

test('args bound for execFile are validated', () => {
  assert.equal(
    udid('150487ab-81eb-4ee2-96f6-996ad50f908d'),
    '150487ab-81eb-4ee2-96f6-996ad50f908d',
  );
  assert.throws(() => udid('booted'));
  assert.throws(() => udid('--set /tmp'));
  assert.equal(url('myapp://item/1'), 'myapp://item/1');
  assert.throws(() => url('-h'));
  assert.throws(() => url('not a url'));
});

test('textToKeys maps US-layout characters and refuses the rest', () => {
  assert.deepEqual(textToKeys('aA!\n'), [
    { usage: 4, shift: false },
    { usage: 4, shift: true },
    { usage: 30, shift: true },
    { usage: 40, shift: false },
  ]);
  assert.equal(textToKeys('café'), null);
});

test('frameSplitter reassembles frames across arbitrary chunk boundaries', () => {
  const frame = (bytes: number[]) =>
    Buffer.concat([Buffer.from([0, 0, 0, bytes.length]), Buffer.from(bytes)]);
  const stream = Buffer.concat([frame([1, 2, 3]), frame([4]), frame([5, 6])]);
  const seen: number[][] = [];
  const push = frameSplitter((jpeg) => seen.push([...jpeg]));
  const cuts = [0, 2, 5, 6, 11, stream.length];
  for (let i = 0; i < cuts.length - 1; i++)
    push(stream.subarray(cuts[i], cuts[i + 1]));
  assert.deepEqual(seen, [[1, 2, 3], [4], [5, 6]]);
});
