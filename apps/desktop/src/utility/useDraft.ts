import { useState } from 'react';
import { runUtility } from './runUtility';
import type { UtilityTask } from './prompts';

/**
 * Runs one background task on demand. `draft` resolves to the model's raw answer, or null (no model answered, the web
 * build, an error) so the caller keeps its local text without telling anyone.
 */
export function useDraft(task: UtilityTask, spaceId: string) {
  // A count, not a flag: StrictMode runs a dialog's draft effect twice, and the first to finish mustn't end the shimmer.
  const [inFlight, setInFlight] = useState(0);
  const draft = async (prompt: string | Promise<string>) => {
    setInFlight((n) => n + 1);
    try {
      return await runUtility(task, spaceId, await prompt);
    } catch (error) {
      console.warn(`${task} draft failed`, error);
      return null;
    } finally {
      setInFlight((n) => n - 1);
    }
  };
  return { draft, isDrafting: inFlight > 0 };
}
