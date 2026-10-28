import { useState, type CSSProperties, type ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger,
} from '@/components/ai-elements/context';
import type { Provider } from './model';
import { useRemoteMachine } from './remote/origin';
import { ProviderMark } from './ui';
import { LimitBars, UpdatedAt } from './usage/LimitBars';
import { hottest, TONE_COLORS, toneFor } from './usage/limits';
import type { Usage } from './usage/model';
import { useAccountLimits } from './usage/useAccountLimits';
import { TOKENS } from '@mochi/domain/lib/format';

const USD = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<
  Provider,
  string
>;

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
  // Another computer's thread runs on that computer's account: this one's plan windows would be the wrong ones.
  const isRemote = !!useRemoteMachine();
  const { limits, refresh } = useAccountLimits(provider, spaceId, !isRemote);
  const [isOpen, setOpen] = useState(false);
  const open = (next: boolean) => {
    setOpen(next);
    if (next) refresh();
  };
  const share = context.max ? Math.min(1, context.used / context.max) : 0;
  const pct = Math.round(share * 100);
  const tone = toneFor(share);
  // A plan window only takes the outer arc once it's worth a glance (warning tone and up).
  const top = hottest(limits?.windows ?? []);
  const plan = top && toneFor(top.usedPct / 100) !== 'normal' ? top : undefined;
  const label = `Context ${pct}% used${plan ? `, ${plan.label.toLowerCase()} limit ${Math.round(plan.usedPct)}% used` : ''}`;
  return (
    <Context
      usedTokens={context.used}
      maxTokens={context.max}
      open={isOpen}
      onOpenChange={open}
      openDelay={150}
      closeDelay={100}
    >
      <ContextTrigger>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="rounded-full"
          onClick={() => !isOpen && open(true)}
        >
          <Ring share={share} planShare={plan && plan.usedPct / 100} />
        </Button>
      </ContextTrigger>
      <ContextContent side="top" align="end" className="w-72">
        <ContextContentHeader>
          <Section
            label="Context"
            aside={
              <span
                className="tabular type-caption text-muted-foreground"
                style={{
                  color: tone === 'normal' ? undefined : TONE_COLORS[tone],
                }}
              >
                {pct}%
              </span>
            }
          >
            <p className="tabular type-caption text-muted-foreground">
              {TOKENS.format(context.used)} of {TOKENS.format(context.max)}{' '}
              tokens
            </p>
            <Progress
              value={pct}
              className="bg-muted-foreground/20"
              aria-label={`Context: ${pct}% used`}
              style={{ '--progress-color': TONE_COLORS[tone] } as CSSProperties}
            />
            <p className="type-caption text-subtle-foreground">
              {PROVIDER_NAMES[provider]} compacts the conversation automatically
              near the limit.
            </p>
          </Section>
        </ContextContentHeader>
        <ContextContentBody className="flex flex-col gap-4">
          {!!usage && (
            <Section
              label="This session"
              aside={
                usage.costUsd !== null && (
                  <span className="tabular type-caption text-muted-foreground">
                    {USD.format(usage.costUsd)}
                  </span>
                )
              }
            >
              <p className="tabular type-caption text-muted-foreground">
                {TOKENS.format(usage.input)} in · {TOKENS.format(usage.output)}{' '}
                out
                {usage.cached !== undefined &&
                  ` · ${TOKENS.format(usage.cached)} cached`}
              </p>
            </Section>
          )}
          {!isRemote && (
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
          )}
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}

function Section({
  label,
  aside,
  children,
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
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
const C = (r: number) => 2 * Math.PI * r;

/**
 * No text: the arc and its colour step (normal, warning at 70%, destructive above 90%) say it. With `planShare`, the plan
 * window takes the outer arc and the context shrinks inside it.
 */
function Ring({ share, planShare }: { share: number; planShare?: number }) {
  const hasPlan = planShare !== undefined;
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden
      className="-rotate-90"
    >
      {hasPlan && <Arc r={7} width={1.5} share={planShare} />}
      <Arc r={hasPlan ? 3.75 : 6} width={hasPlan ? 1.75 : 2} share={share} />
    </svg>
  );
}

function Arc({ r, width, share }: { r: number; width: number; share: number }) {
  const c = SIZE / 2;
  return (
    <>
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={width}
      />
      {share > 0 && (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={TONE_COLORS[toneFor(share)]}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${C(r) * Math.min(1, share)} ${C(r)}`}
        />
      )}
    </>
  );
}
