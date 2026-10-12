import type { TriggerWhen } from '../host/types/schedule.ts';
import { describeCron } from './cron.ts';
import { PR_EVENT_LABELS } from './due.ts';

/** "Every day at 02:00", "PR opened on release/*", "PR CI failed with label deps". */
export function describeTrigger(when: TriggerWhen) {
  if (when.kind === 'cron') return describeCron(when.cron);
  const scope = [when.branch && `on ${when.branch}`, when.label && `with label ${when.label}`].filter(Boolean).join(' ');
  return `PR ${PR_EVENT_LABELS[when.event]}${scope ? ` ${scope}` : ''}`;
}
