import { expect, it } from '@effect/vitest';
import { isSafeOtlpUrl } from './launch.ts';

it('spans leave this computer only over TLS; plain http is for a collector on loopback', () => {
  expect(isSafeOtlpUrl(new URL('https://otel.example.com'))).toBe(true);
  expect(isSafeOtlpUrl(new URL('http://127.0.0.1:4318'))).toBe(true);
  expect(isSafeOtlpUrl(new URL('http://localhost:4318'))).toBe(true);
  expect(isSafeOtlpUrl(new URL('http://[::1]:4318'))).toBe(true);
  expect(isSafeOtlpUrl(new URL('http://otel.example.com'))).toBe(false);
  expect(isSafeOtlpUrl(new URL('http://192.168.1.5:4318'))).toBe(false);
});
