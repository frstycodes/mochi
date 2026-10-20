import type { WebContents } from 'electron';
import type { AgentDecision } from '../../src/host/types/agent.ts';

// Event methods (returning an unsubscribe) are pushed from main with `sender.send`, so only promise methods get a handler.
// Args arrive untyped from the renderer: every handler validates them before use.
export type Handlers<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: T[K] extends (...args: never[]) => infer R
    ? (sender: WebContents, ...args: unknown[]) => R
    : never;
};

export const MAX_MODEL_CHARS = 128;

export const notImplemented =(name: string) => async (): Promise<never> => {
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

const DECISIONS = ['allow', 'deny', 'answer'];

/** A queue card's answer as the renderer or a notification sent it; `answers` holds one list of picks per question. */
export function agentDecision(value: unknown): AgentDecision {
  const d = record(value, 'decision');
  if (!DECISIONS.includes(d.kind as string)) throw new TypeError('decision.kind must be allow, deny or answer');
  if (d.kind === 'answer' && !(Array.isArray(d.answers) && d.answers.every((a) => Array.isArray(a) && a.every((x) => typeof x === 'string')))) throw new TypeError('decision.answers must be a list of string lists, one per question');
  if (d.kind === 'deny' && d.message !== undefined) string(d.message, 'decision.message', 4096);
  for (const key of ['forSession', 'interrupt']) if (d[key] !== undefined && typeof d[key] !== 'boolean') throw new TypeError(`decision.${key} must be a boolean`);
  return d as unknown as AgentDecision;
}

/** A profile id, checked strictly: it names folders on disk. */
export function spaceIdOf(value: unknown) {
  const id = string(value, 'spaceId', 128);
  if (!/^[a-z0-9-]+$/.test(id)) throw new TypeError('spaceId must be a profile id');
  return id;
}
