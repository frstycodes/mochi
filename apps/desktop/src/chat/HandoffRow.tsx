import { useState } from 'react';
import { ChevronRight, Transfer } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { Handoff } from '../model';
import { clock } from '../progress';
import { useModels } from '../ModelControls';
import { PROVIDER_NAME } from '../rewind/handoff';
import { optionFor } from '../runtime/models';
import { Expand } from '../WorkLog';

const FALLBACK_NOTE = {
  timeout: 'drafting took too long, so this is Mochi’s own summary',
  error: 'drafting failed, so this is Mochi’s own summary',
} satisfies Record<NonNullable<Handoff['fallback']>, string>;

/**
 * A handoff or provider switch as one log line like a compaction: a switch waits for your next message, then names what the
 * new provider got; open, the exact context it got (a switch) or the prompt it started from (an older handoff).
 */
export function HandoffRow({
  handoff,
  at,
  spaceId,
}: {
  handoff: Handoff;
  at: number;
  spaceId: string;
}) {
  const [isOpen, setOpen] = useState(false);
  const hasBody = handoff.status === 'started' && !!handoff.prompt;
  return (
    <div className="-mx-2 flex flex-col">
      <div
        className={cn(
          'group/log relative isolate flex h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground',
          hasBody && 'hover:bg-accent/60 hover:text-foreground',
        )}
      >
        {hasBody && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label="Handoff prompt"
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        )}
        <Transfer aria-hidden className="size-4 shrink-0" />
        {isSwitch(handoff) ? (
          <SwitchLine handoff={handoff} spaceId={spaceId} />
        ) : (
          <HandoffLine handoff={handoff} />
        )}
        {hasBody && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none',
              isOpen && 'rotate-90',
            )}
          />
        )}
      </div>
      {hasBody && (
        <Expand isOpen={isOpen}>
          <div className="mx-2 mt-1 flex flex-col gap-2 rounded-xl border px-3 py-2.5">
            <MessageResponse
              isAnimating={false}
              className="max-h-[min(50vh,28rem)] overflow-y-auto type-prose text-foreground"
            >
              {handoff.prompt}
            </MessageResponse>
            <p className="type-caption text-subtle-foreground">
              {[
                isSwitch(handoff)
                  ? `${PROVIDER_NAME[handoff.to]} got this as context at ${clock(at)}; your message went as you typed it`
                  : `${PROVIDER_NAME[handoff.to]} started from this at ${clock(at)}`,
                handoff.fallback && FALLBACK_NOTE[handoff.fallback],
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </Expand>
      )}
    </div>
  );
}

const isSwitch = (handoff: Handoff) =>
  handoff.status === 'pending' || handoff.contents !== undefined;

/** `Switches to Codex · GPT-5.5 on your next message`, then `Switched to Codex · GPT-5.5` and what the package held. */
function SwitchLine({
  handoff,
  spaceId,
}: {
  handoff: Handoff;
  spaceId: string;
}) {
  const target = useTargetName(handoff, spaceId);
  if (handoff.status === 'pending')
    return (
      <span className="min-w-0 truncate">
        Switches to {target} on your next message
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">Switched to {target}</span>
      {!!handoff.contents && (
        <span className="min-w-0 truncate text-subtle-foreground">
          {handoff.contents}
        </span>
      )}
    </span>
  );
}

/** The provider, then the model's name from its catalog (the id until that loads); just the provider for its default model. */
function useTargetName(handoff: Handoff, spaceId: string) {
  const catalog = useModels(spaceId);
  const provider = PROVIDER_NAME[handoff.to];
  if (!handoff.model) return provider;
  return `${provider} · ${optionFor(catalog[handoff.to], handoff.model, handoff.to).name}`;
}

function HandoffLine({ handoff }: { handoff: Handoff }) {
  const names = `from ${PROVIDER_NAME[handoff.from]} to ${PROVIDER_NAME[handoff.to]}`;
  if (handoff.status === 'drafting')
    return (
      <Shimmer as="span" className="min-w-0 truncate">
        {`Handing off ${names}, drafting the prompt…`}
      </Shimmer>
    );
  if (handoff.status === 'failed')
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-destructive">
          Could not hand off {names}
        </span>
        {!!handoff.error && (
          <span className="min-w-0 truncate text-subtle-foreground">
            {handoff.error}
          </span>
        )}
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">Handed off {names}</span>
      {!!handoff.fallback && (
        <span className="min-w-0 truncate text-subtle-foreground">
          with Mochi’s own summary
        </span>
      )}
    </span>
  );
}
