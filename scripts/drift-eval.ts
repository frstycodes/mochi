// Runs the labelled drift cases through the real classifier: `node scripts/drift-eval.ts`. Needs a logged-in `claude` CLI.
// The app's 4s budget assumes a prewarmed process; a CLI cold start takes ~5s, so this measures verdicts, not latency.
import { execFile } from 'node:child_process';
import {
  CLASSIFY_PROMPT,
  classifyInput,
  classifyWithModel,
  judgeDrift,
  setDriftClassifier,
} from '../src/drift.ts';
import { DRIFT_CASES, replay, score } from '../src/drift.cases.ts';

const MODEL = 'claude-haiku-5-5';

function haiku(input: string) {
  return new Promise<unknown>((resolve, reject) => {
    const child = execFile(
      'claude',
      [
        '-p',
        '--model',
        MODEL,
        '--system-prompt',
        CLASSIFY_PROMPT,
        '--tools',
        '',
        '--no-session-persistence',
      ],
      (error, stdout) => {
        if (error) return reject(error);
        resolve(
          JSON.parse(
            stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1),
          ),
        );
      },
    );
    child.stdin!.end(input);
  });
}

let modelCalls = 0;
// The same path as the desktop build: `judgeDrift` in the renderer, `classifyWithModel` behind the host's classify.
setDriftClassifier((prompt, thread) =>
  classifyWithModel(
    prompt,
    thread,
    () => (modelCalls++, haiku(classifyInput(prompt, thread))),
    60_000,
  ),
);
const verdicts = await Promise.all(
  DRIFT_CASES.map((c) => judgeDrift(c.prompt, replay(c))),
);
const flags = verdicts.map((v) => v.kind === 'off-goal');
DRIFT_CASES.forEach((c, i) => {
  if (flags[i] !== c.isOffGoal)
    console.log(
      `${c.isOffGoal ? 'missed' : 'false alarm'}: ${c.name}: ${verdicts[i].reason}`,
    );
});
console.log(
  `${MODEL}, ${DRIFT_CASES.length} cases, ${modelCalls} model calls`,
  score(flags),
);
