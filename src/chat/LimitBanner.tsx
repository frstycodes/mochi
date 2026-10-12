import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Hourglass } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { host } from '../host';
import type { Provider, Thread } from '../model';
import { openRewind } from '../rewind/requests';
import { PROVIDER_NAME } from '../rewind/handoff';
import { HARNESSES } from '../settings/harnesses';
import { useHarness } from '../store';
import { ProviderMark } from '../ui';

/** A live thread whose account hit its usage limit. Every way forward is a click: nothing resumes, bills or switches by itself. */
export function LimitBanner({ thread }: { thread: Thread }) {
  const limit = thread.live?.limit;
  return <AnimatePresence initial={false}>{!!limit && <LimitCard thread={thread} resetsAt={limit.resetsAt} />}</AnimatePresence>;
}

function LimitCard({ thread, resetsAt }: { thread: Thread; resetsAt?: string }) {
  const { dispatch } = useHarness();
  const provider = thread.providers[0];
  const other: Provider = provider === 'claude' ? 'codex' : 'claude';
  const isReset = useIsPast(resetsAt);
  const hasApiKey = useHasApiKey(provider) && !thread.live?.isOnApiKey;
  const resume = (onApiKey?: boolean) => dispatch({ type: 'resume', threadId: thread.id, onApiKey });

  return (
    <motion.section
      aria-label="Usage limit reached"
      role="status"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      className="mb-2 flex flex-col gap-2.5 rounded-xl bg-popover p-3 shadow-popover"
    >
      <div className="flex items-start gap-2">
        <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="type-body">{PROVIDER_NAME[provider]} hit this profile&apos;s usage limit</p>
          <p className="type-caption text-subtle-foreground">
            {resetsAt ? `${isReset ? 'Reset at' : 'Resets at'} ${resetTime(resetsAt)}.` : 'No reset time was reported.'} Resume continues on the same account.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!isReset} onClick={() => resume()}>
          {isReset ? 'Resume' : `Resume at ${resetTime(resetsAt!)}`}
        </Button>
        {hasApiKey && (
          <Button variant="outline" onClick={() => resume(true)}>
            Continue on API key
            <span className="text-subtle-foreground">· billed per use</span>
          </Button>
        )}
        <Button variant="ghost" onClick={() => openRewind({ kind: 'handoff', threadId: thread.id })}>
          <ProviderMark provider={other} size={14} />
          Hand off to {PROVIDER_NAME[other]}
        </Button>
      </div>
    </motion.section>
  );
}

/** True once `at` has passed, re-rendering at that moment; true when there is no time to wait for. */
function useIsPast(at?: string) {
  const target = at ? Date.parse(at) : NaN;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const ms = target - Date.now();
    if (!(ms > 0)) return;
    const id = window.setTimeout(() => setNow(Date.now()), ms);
    return () => window.clearTimeout(id);
  }, [target]);
  return !(target > now);
}

function useHasApiKey(provider: Provider) {
  const [isSet, setSet] = useState(false);
  useEffect(() => {
    if (!HARNESSES[provider].apiKey) return;
    let isCurrent = true;
    host.settings.apiKey(provider).then(
      (key) => isCurrent && setSet(key.isSet),
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, [provider]);
  return isSet;
}

const DAY_MS = 86_400_000;

function resetTime(at: string) {
  const date = new Date(at);
  const isSoon = date.getTime() - Date.now() < DAY_MS;
  return date.toLocaleString([], isSoon ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
