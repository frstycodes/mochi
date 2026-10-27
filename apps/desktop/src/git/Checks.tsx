import {
  ChevronDown,
  ClockCircle,
  XCircle,
  MinusCircle,
  CheckCircle,
} from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CheckState, PrCheck } from '../host/types/git';

const CHECK = {
  pass: { icon: CheckCircle, className: 'text-success', label: 'Passed' },
  fail: { icon: XCircle, className: 'text-destructive', label: 'Failed' },
  pending: { icon: ClockCircle, className: 'text-warning', label: 'Running' },
  skipping: {
    icon: MinusCircle,
    className: 'text-subtle-foreground',
    label: 'Skipped',
  },
  cancel: {
    icon: MinusCircle,
    className: 'text-subtle-foreground',
    label: 'Cancelled',
  },
} satisfies Record<
  CheckState,
  { icon: typeof CheckCircle; className: string; label: string }
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
  const { icon: Icon, className } = CHECK[worst];
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
      <Icon data-icon="inline-start" className={className} />
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
        const { icon: Icon, className, label } = CHECK[check.state];
        return (
          <li
            key={check.name}
            className="flex h-6 items-center gap-2 px-1 type-meta"
          >
            <Icon
              className={cn('size-3.5 shrink-0', className)}
              aria-label={label}
            />
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
