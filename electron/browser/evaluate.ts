// browser_eval's limits and its CDP answer turned into what the agent reads. No electron import, so it runs in plain-Node tests.

export const EVAL_TIMEOUT_MS = 10_000;
export const EVAL_MAX_CHARS = 20_000;
const STACK_LINES = 4;

export interface CdpEvaluate {
  result?: { type: string; value?: unknown; description?: string; unserializableValue?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } };
}

/** The last expression's value as JSON, capped; a thrown error comes back as its message and the stack's first lines. */
export function evalResult({ result, exceptionDetails }: CdpEvaluate): { value: string; isTruncated: boolean } {
  if (exceptionDetails) {
    const text = exceptionDetails.exception?.description ?? String(exceptionDetails.exception?.value ?? exceptionDetails.text ?? 'Script threw');
    throw new Error(text.split('\n').slice(0, STACK_LINES).join('\n'));
  }
  const json = result?.unserializableValue ?? (result?.type === 'undefined' ? 'undefined' : (JSON.stringify(result?.value) ?? result?.description ?? 'undefined'));
  const isTruncated = json.length > EVAL_MAX_CHARS;
  return { value: isTruncated ? json.slice(0, EVAL_MAX_CHARS) : json, isTruncated };
}

/** Rejects after `ms` with a reason the agent can act on; the page keeps whatever the script already did. */
export function withTimeout<T>(run: Promise<T>, ms = EVAL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`The script ran past ${ms / 1000}s and was abandoned; anything it already did stays`)), ms)));
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}
