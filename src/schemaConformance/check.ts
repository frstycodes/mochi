// Type-level only: each `packages/schema` schema decodes to exactly the type the app uses today (less the `v` versioned
// records add), so callers can swap a cast for a decode without a type change. A mismatch fails `pnpm typecheck`. Delete an
// entry once its TS type is derived from the schema.
import type { Schema } from 'effect';

export type Plain<T> = T extends (...args: never[]) => unknown ? T : T extends ReadonlyArray<unknown> ? { -readonly [K in keyof T]: Plain<T[K]> } : T extends object ? { -readonly [K in keyof T as K extends 'v' ? never : K]: Plain<T[K]> } : T;
export type Same<A, B> = (<T>() => T extends Plain<A> ? 1 : 2) extends <T>() => T extends Plain<B> ? 1 : 2 ? true : false;
export type Decoded<S extends Schema.Top> = S['Type'];
export type Args<F> = F extends (...args: infer P) => unknown ? P : never;
export type Result<F> = F extends (...args: never[]) => Promise<infer R> ? R : F extends (listener: (payload: infer P) => void) => unknown ? P : never;
/** Every method of `Host` has an entry in `Table`, with matching arguments and result. */
export type Rpc<Host, Table> = { [K in keyof Host]-?: K extends keyof Table ? Table[K] extends { input: Schema.Top; output: Schema.Top } ? [Same<Decoded<Table[K]['input']>, Args<Host[K]>>, Same<Decoded<Table[K]['output']>, Result<Host[K]>>] : Table[K] extends { event: Schema.Top } ? Same<Decoded<Table[K]['event']>, Result<Host[K]>> : false : false };
export type Check<T extends true | readonly true[] | Record<string, true | readonly true[]>> = T;


// Guards against a vacuous `Same`: a field type change must fail.
export type SelfTest = Check<Same<{ a: string }, { a: number }> extends false ? true : false>;
