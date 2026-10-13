import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Context, ContextContent, ContextContentBody, ContextContentHeader, ContextTrigger } from '@/components/ai-elements/context';
import type { Provider } from './model';
import { ProviderMark } from './ui';
import { LimitBars, UpdatedAt } from './usage/LimitBars';
import { TONE_COLORS, toneFor } from './usage/limits';
import type { Usage } from './usage/model';
import { useAccountLimits } from './usage/useAccountLimits';

const TOKENS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const USD = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;

/**
 * The thread's context window as a ring in the composer footer. Hover or focus opens the detail: context, this session's
 * tokens, and the account's plan windows, read fresh from the provider on open. A tap opens it too: touch never hovers.
 */
export function ContextRing({
  provider,
  spaceId,
  context,
  usage,
}: {
  provider: Provider;
  spaceId: string;
  context: { used: number; max: number };
  usage?: Usage;
}) {
  const { limits, refresh } = useAccountLimits(provider, spaceId);
  const [isOpen, setOpen] = useState(false);
  const open = (next: boolean) => {
    setOpen(next);
    if (next) refresh();
  };
  const share = context.max ? Math.min(1, context.used / context.max) : 0;
  const pct = Math.round(share * 100);
  return (
    <Context usedTokens={context.used} maxTokens={context.max} open={isOpen} onOpenChange={open} openDelay={150} closeDelay={100}>
      <ContextTrigger>
        <Button variant="ghost" size="icon-sm" aria-label={`Context ${pct}% used`} className="rounded-full" onClick={() => !isOpen && open(true)}>
          <Ring share={share} />
        </Button>
      </ContextTrigger>
      <ContextContent side="top" align="end" className="w-72">
        <ContextContentHeader>
          <Section label="Context" aside={<span className="tabular type-caption text-muted-foreground">{pct}%</span>}>
            <p className="tabular type-caption text-muted-foreground">
              {TOKENS.format(context.used)} of {TOKENS.format(context.max)} tokens
            </p>
            <p className="type-caption text-subtle-foreground">{PROVIDER_NAMES[provider]} compacts the conversation automatically near the limit.</p>
          </Section>
        </ContextContentHeader>
        <ContextContentBody className="flex flex-col gap-4">
          {!!usage && (
            <Section
              label="This session"
              aside={usage.costUsd !== null && <span className="tabular type-caption text-muted-foreground">{USD.format(usage.costUsd)}</span>}
            >
              <p className="tabular type-caption text-muted-foreground">
                {TOKENS.format(usage.input)} in · {TOKENS.format(usage.output)} out{usage.cached !== undefined && ` · ${TOKENS.format(usage.cached)} cached`}
              </p>
            </Section>
          )}
          <Section
            label={
              <span className="flex items-center gap-1.5">
                <ProviderMark provider={provider} size={14} />
                {PROVIDER_NAMES[provider]} plan limits
              </span>
            }
            aside={<UpdatedAt limits={limits} />}
          >
            <LimitBars limits={limits} />
          </Section>
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}

function Section({ label, aside, children }: { label: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-caption font-medium text-foreground">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const SIZE = 16;
const R = SIZE / 2 - 2;
const C = 2 * Math.PI * R;

/** No text: the arc and its colour step (normal, warning at 70%, destructive above 90%) say it. */
function Ring({ share }: { share: number }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="-rotate-90">
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--border)" strokeWidth={2} />
      {share > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={TONE_COLORS[toneFor(share)]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${C * share} ${C}`}
        />
      )}
    </svg>
  );
}
