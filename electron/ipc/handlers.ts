import type { WebContents } from 'electron';

// Event methods (returning an unsubscribe) are pushed from main with `sender.send`, so only promise methods get a handler.
// Args arrive untyped from the renderer: every handler validates them before use.
export type Handlers<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: T[K] extends (...args: never[]) => infer R
    ? (sender: WebContents, ...args: unknown[]) => R
    : never;
};

export const notImplemented = (name: string) => async (): Promise<never> => {
  throw new Error(`${name} is not implemented yet`);
};

export function string(value: unknown, name: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new TypeError(`${name} must be a string up to ${maxLength} chars`);
  return value;
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new TypeError(`${name} must be an integer in ${min}–${max}`);
  return value as number;
}
