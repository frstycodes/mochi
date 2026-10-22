import type { WebContents } from 'electron';

// Event methods (returning an unsubscribe) are pushed from main with `sender.send`, so only promise methods get a handler.
// Args are already decoded with `@mochi/schema` by the time a handler runs (`layerHost`).
export type Handlers<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: T[K] extends (...args: never[]) => infer R
    ? (sender: WebContents, ...args: Parameters<T[K]>) => R
    : never;
};

export const notImplemented = (name: string) => async (): Promise<never> => {
  throw new Error(`${name} is not implemented yet`);
};
