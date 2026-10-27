import {
  ChevronDown,
  XCircle,
  MinusCircle,
  CheckCircle,
  type IconComponent,
} from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CheckState, PrCheck } from '../host/types/git';

/** Every CI check mark, here and in the summary's PR row. Pending is a grey dot: warning amber is only "needs you". */
export const CHECK = {
  pass: { icon: CheckCircle, tone: 'text-success', label: 'Passed' },
  fail: { icon: XCircle, tone: 'text-destructive', label: 'Failed' },
  pending: { tone: 'text-subtle-foreground', label: 'Running' },
  skipping: {
    icon: MinusCircle,
    tone: 'text-subtle-foreground',
    label: 'Skipped',
  },
  cancel: {
    icon: MinusCircle,
    tone: 'text-subtle-foreground',
    label: 'Cancelled',
  },
} satisfies Record<
  CheckState,
  { icon?: IconComponent; tone: string; label: string }
>;

// Worst state first, so the summary icon is the one that needs you.
const SEVERITY = [
  'fail',
  'pending',
  'cancel',
  'skipping',
  'pass',
] satisfies CheckState[];

export function ChecksSummary({
  checks,
  isOpen,
  onToggle,
}: {
  checks: PrCheck[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const worst = SEVERITY.find((state) =>
    checks.some((c) => c.state === state),
  )!;
  const failed = checks.filter((c) => c.state === 'fail').length;
  const passed = checks.filter((c) => c.state === 'pass').length;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={isOpen}
      onClick={onToggle}
      className="ml-auto text-muted-foreground"
    >
      <CheckMark state={worst} data-icon="inline-start" className="size-3.5" />
      <span className="tabular">
        {failed ? `${failed} failing` : `${passed}/${checks.length} checks`}
      </span>
      <ChevronDown
        data-icon="inline-end"
        className={cn(
          'text-subtle-foreground transition-transform duration-150',
          isOpen && 'rotate-180',
        )}
      />
    </Button>
  );
}

export function CheckList({ checks }: { checks: PrCheck[] }) {
  return (
    <ul className="flex flex-col gap-0.5" aria-label="PR checks">
      {checks.map((check) => {
        const { label } = CHECK[check.state];
        return (
          <li
            key={check.name}
            className="flex h-6 items-center gap-2 px-1 type-meta"
          >
            <CheckMark state={check.state} className="size-3.5" />
            {check.link ? (
              <a
                href={check.link}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-muted-foreground hover:text-foreground"
              >
                {check.name}
              </a>
            ) : (
              <span className="min-w-0 truncate text-muted-foreground">
                {check.name}
              </span>
            )}
            <span className="ml-auto shrink-0 type-caption text-subtle-foreground">
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CheckMark({
  state,
  className,
  ...props
}: {
  state: CheckState;
  className?: string;
  'data-icon'?: 'inline-start';
}) {
  const check = CHECK[state];
  if ('icon' in check)
    return (
      <check.icon
        aria-label={check.label}
        className={cn('shrink-0', check.tone, className)}
        {...props}
      />
    );
  return (
    <span
      role="img"
      aria-label={check.label}
      className={cn(
        'flex shrink-0 items-center justify-center',
        check.tone,
        className,
      )}
      {...props}
    >
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}
