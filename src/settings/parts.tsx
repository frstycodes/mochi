import { useState, type ReactNode } from 'react';
import { Check, Copy3, InfoCircle, Refresh, TickCircle, Warning } from 'reicon-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { host } from '../host';
import { IconSwap, TooltipIconButton } from '../ui';
import type { InstallState } from './AgentSettings';

/**
 * An inset grouped list, like Apple's System Settings: an optional heading, rows on one card surface split by inset
 * hairlines, and the explanation as a footnote under the group. `id` makes the whole group a deep-link target.
 */
export function SettingsGroup({ id, title, footer, children }: { id?: string; title?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section data-setting-id={id} className="flex flex-col gap-1.5 rounded-xl transition-colors duration-700 data-flash:bg-accent/60">
      {!!title && <h3 className="px-3 type-meta font-medium text-muted-foreground">{title}</h3>}
      <div className="rounded-xl border bg-card">{children}</div>
      {!!footer && <p className="px-3 type-caption text-muted-foreground">{footer}</p>}
    </section>
  );
}

/**
 * One row: label (and a short secondary line) on the left, control on the right, wrapping under on narrow screens.
 * `id` is the deep-link target and names the control `setting-<id>` for the label; `children` expand under the row.
 */
export function SettingsRow({ id, label, description, control, children, className, ...props }: { id?: string; label: ReactNode; description?: ReactNode; control?: ReactNode } & Omit<React.ComponentProps<'div'>, 'id'>) {
  return (
    <div
      data-setting-id={id}
      {...props}
      className={cn("relative flex flex-col gap-2.5 px-3.5 py-2.5 transition-colors duration-700 first:rounded-t-xl last:rounded-b-xl not-first:before:absolute not-first:before:inset-x-3.5 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border data-flash:bg-accent", className)}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 *:not-first:shrink-0">
        <div className="min-w-40 flex-1">
          {id ? (
            <label htmlFor={settingControlId(id)} className="block type-body">
              {label}
            </label>
          ) : (
            <div className="type-body">{label}</div>
          )}
          {!!description && <div className="type-meta text-muted-foreground">{description}</div>}
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}

export const settingControlId = (id: string) => `setting-${id}`;

// An undo needs time to reach for, so its toast outlasts a plain one.
export const UNDO_MS = 8000;

export function LoginBadge({ install }: { install: InstallState | undefined }) {
  if (!install || install === 'checking')
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Spinner data-icon="inline-start" />
        Checking
      </Badge>
    );
  if (!install.path) return <StatusBadge tone="warning">Not installed</StatusBadge>;
  if (install.login.state === 'logged-out') return <StatusBadge tone="warning">Signed out</StatusBadge>;
  if (install.login.state === 'unknown') return <StatusBadge tone="warning">Couldn't check</StatusBadge>;
  const { method, plan } = install.login;
  return <StatusBadge tone="success">{plan ? `${plan} plan · ${method}` : method}</StatusBadge>;
}

function StatusBadge({ tone, children }: { tone: 'success' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'success' ? TickCircle : Warning;
  return (
    <Badge variant="outline">
      <Icon data-icon="inline-start" className={tone === 'success' ? 'text-success' : 'text-warning'} />
      {children}
    </Badge>
  );
}

/** What to run in the user's own terminal when an account is signed out or its status couldn't be read. Never a login form. */
export function SignInSteps({ install, command, onCheck }: { install: InstallState | undefined; command: string; onCheck: () => void }) {
  if (!install || install === 'checking' || !install.path || install.login.state === 'logged-in') return null;
  const reason = install.login.state === 'unknown' ? install.login.reason : undefined;
  return (
    <div className="flex flex-col items-start gap-2 type-meta text-muted-foreground">
      <p>{reason ? `Couldn't read the login: ${reason}` : 'Sign in from a terminal, in the tool itself, then check again.'}</p>
      <CommandLine command={command} />
      <Button variant="outline" size="sm" onClick={onCheck}>
        <Refresh data-icon="inline-start" />
        Check again
      </Button>
    </div>
  );
}

export function CommandLine({ command }: { command: string }) {
  const [isCopied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="flex w-full items-center gap-1 rounded-lg bg-muted py-0.5 pr-0.5 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-mono type-meta text-foreground" title={command}>
        {command}
      </code>
      <TooltipIconButton label={isCopied ? 'Copied' : 'Copy command'} hint="Paste it into a terminal" onClick={copy}>
        <IconSwap id={isCopied ? 'copied' : 'copy'}>{isCopied ? <Check /> : <Copy3 />}</IconSwap>
      </TooltipIconButton>
    </div>
  );
}

/** Text input that saves on blur or Enter, so typing a path doesn't re-run detection per keystroke. */
export function CommitInput({ value, onCommit, className, ...props }: { value: string; onCommit: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onBlur'>) {
  return (
    <Input
      key={value}
      defaultValue={value}
      spellCheck={false}
      onBlur={(e) => e.target.value.trim() !== value && onCommit(e.target.value.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={cn('w-full sm:w-60', className)}
      {...props}
    />
  );
}

/** A folder path: typed (saved on blur or Enter) or picked with the OS folder picker, which only the desktop app can open. */
export function FolderInput({ id, value, placeholder, onCommit }: { id: string; value: string; placeholder: string; onCommit: (path: string) => void }) {
  const browse = () =>
    host.fs.pickFolder(value || placeholder).then(
      (path) => path && onCommit(path),
      (error: Error) => toast.error('Could not open the folder picker', { description: error.message }),
    );
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <CommitInput id={settingControlId(id)} value={value} placeholder={placeholder} onCommit={onCommit} className="flex-1 font-mono placeholder:font-mono sm:w-60 sm:flex-none" />
      {host.isDesktop && (
        <Button variant="outline" size="sm" onClick={() => void browse()}>
          Browse
        </Button>
      )}
    </div>
  );
}

/** Rows the main process reads; the web build says why they're missing instead. `what` is a sentence naming what needs the desktop app. */
export function DesktopOnly({ what, children }: { what: ReactNode; children: ReactNode }) {
  return host.isDesktop ? children : <DesktopOnlyNotice what={what} />;
}

export function DesktopOnlyNotice({ what }: { what: ReactNode }) {
  return (
    <Alert>
      <InfoCircle />
      <AlertTitle>Needs the desktop app</AlertTitle>
      <AlertDescription>{what} Here, threads run on the demo agents, so everything else keeps working.</AlertDescription>
    </Alert>
  );
}

/** A choice from a list too long for toggles. Radix Select, never a native one; `value` can't be empty (Radix reserves '' for "nothing chosen"). */
export function SettingsSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  className,
  ...props
}: { id?: string; value: T; options: readonly { value: T; label: string; className?: string }[]; onChange: (value: T) => void; className?: string; 'aria-label'?: string; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={props.disabled}>
      <SelectTrigger id={id && settingControlId(id)} aria-label={props['aria-label']} size="sm" className={cn('w-44', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One of a few named values, as separate bordered toggles; the row's label names the group. */
export function SettingsChoice<T extends string>({ id, value, options, onChange, ...props }: { id: string; value: T; options: readonly { value: T; label: string; className?: string }[]; onChange: (value: T) => void; 'aria-label'?: string }) {
  return (
    <ToggleGroup id={settingControlId(id)} aria-label={props['aria-label']} type="single" size="sm" variant="outline" value={value} onValueChange={(v) => v && onChange(v as T)}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={o.className}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A whole number that saves on blur or Enter, clamped to its range. */
export function NumberInput({ id, value, min, max, step, onCommit }: { id: string; value: number; min: number; max: number; step: number; onCommit: (value: number) => void }) {
  const commit = (raw: string) => {
    const next = Math.min(max, Math.max(min, Math.round(Number(raw) || value)));
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      id={id}
      key={value}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-24 tabular"
    />
  );
}
