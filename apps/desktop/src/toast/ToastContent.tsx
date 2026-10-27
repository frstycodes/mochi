import type { MouseEvent, ReactNode } from 'react';
import { CheckCircle, XCircle, Info, Warning, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { Toast, ToastType } from './store';

/** A toast's one row, the same in either toaster: what it says (`children`, the summary or a button around it), its action and close. */
export function ToastRow({
  toast,
  onAction,
  onClose,
  children,
}: {
  toast: Toast;
  onAction: (e: MouseEvent) => void;
  onClose: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 pr-2 pl-3">
      {children}
      {!!toast.action && (
        <Button size="sm" variant="outline" onClick={onAction}>
          {toast.action.label}
        </Button>
      )}
      <Button
        data-toast-close
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        className="mt-0.5 text-muted-foreground"
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}

export function ToastSummary({ toast }: { toast: Toast }) {
  return (
    <>
      <ToastIcon type={toast.type} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 type-body font-medium [overflow-wrap:anywhere]">
            {toast.title}
          </p>
          {toast.count > 1 && <RepeatCount count={toast.count} />}
        </div>
        {!!toast.description && (
          <div
            className={cn(
              'type-meta text-muted-foreground [overflow-wrap:anywhere]',
              !toast.expand && 'cursor-text select-text',
            )}
          >
            {toast.description}
          </div>
        )}
      </div>
    </>
  );
}

const ICONS = {
  default: null,
  success: <CheckCircle className="size-4 text-success" />,
  info: <Info className="size-4 text-info" />,
  warning: <Warning className="size-4 text-warning" />,
  error: <XCircle className="size-4 text-destructive" />,
  loading: <Spinner className="text-muted-foreground" />,
} satisfies Record<ToastType, unknown>;

function ToastIcon({ type }: { type: ToastType }) {
  const icon = ICONS[type];
  return (
    !!icon && (
      <span aria-hidden className="mt-0.5 flex shrink-0">
        {icon}
      </span>
    )
  );
}

function RepeatCount({ count }: { count: number }) {
  return (
    <span
      aria-label={`Shown ${count} times`}
      className="shrink-0 rounded-full bg-muted px-1.5 type-caption font-medium text-muted-foreground tabular"
    >
      {count}
    </span>
  );
}
