import { useState, type KeyboardEvent } from 'react';
import { ArrowRight, Flag, Setting2, ShieldCheck, Trash3, type IconComponent } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ActivityEntry, QueueItem } from '../model';
import { clock } from '../progress';
import { decideTool } from '../runtime/tools';
import { SettingsSelect } from '../settings/parts';
import { setPrefs, usePrefs } from '../settings/prefs';
import { isSwitch, isWidgetSetting, optionLabel, settingPatch, settingValue, WIDGET_SETTINGS, type WidgetSettingKey } from '../settings/settingOptions';
import { useHarness } from '../store';

/** A Mochi widget where the agent asked: the live card while it waits, then its one-line record. */
export function CardEntry({ entry, card }: { entry: ActivityEntry; card: NonNullable<ActivityEntry['card']> }) {
  const { state } = useHarness();
  const item = card.isOpen ? state.queue.find((q) => q.id === card.id) : undefined;
  if (item) return <MochiWidget item={item} />;
  // Open with no card behind it: Mochi reloaded while it waited, and main told the agent nothing was done.
  return <EventLine text={card.isOpen ? `Not answered before Mochi reloaded: ${entry.text}` : entry.text} at={entry.at} />;
}

export function EventLine({ text, detail, at }: { text: string; detail?: string; at: number }) {
  return (
    <div className="flex gap-2 type-caption text-muted-foreground">
      <Flag aria-hidden className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0">
        {text}
        {/* The separator travels with the time, so a wrap never leaves it dangling. */}
        <span className="whitespace-nowrap tabular text-subtle-foreground"> · {clock(at)}</span>
        {!!detail && <span className="block text-subtle-foreground">{detail}</span>}
      </p>
    </div>
  );
}

const KIND = {
  setting: { icon: Setting2, label: 'Setting', approve: 'Apply', deny: 'Keep current' },
  delete: { icon: Trash3, label: "Can't be undone", approve: 'Delete', deny: 'Cancel' },
  confirm: { icon: ShieldCheck, label: 'Approval', approve: 'Allow', deny: 'Deny' },
} satisfies Record<string, { icon: IconComponent; label: string; approve: string; deny: string }>;

/** Enter works on whichever button has focus; Esc anywhere inside says no. */
function MochiWidget({ item }: { item: QueueItem }) {
  const decide = useDecision(item);
  const [options, setOptions] = useState<string[]>([]);
  const setting = item.tool?.setting ?? (item.setting && { id: item.setting.id, value: item.setting.suggested ?? '' });
  const kind = setting ? 'setting' : item.tool?.isDestructive ? 'delete' : 'confirm';
  const { icon: Icon, label, approve, deny } = KIND[kind];
  const toggle = (id: string, on: boolean) => setOptions((o) => (on ? [...o, id] : o.filter((x) => x !== id)));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    decide(false);
  };

  return (
    <Card size="sm" data-card={item.id} tabIndex={-1} role="group" aria-label={item.title} onKeyDown={onKeyDown} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader>
        <CardDescription className={cn('flex items-center gap-1 type-caption font-medium', kind === 'delete' ? 'text-destructive' : 'text-foreground')}>
          <Icon aria-hidden className="size-3.5" />
          {label}
        </CardDescription>
        <CardTitle className="text-pretty">{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!!setting && isWidgetSetting(setting.id) && <SettingChange id={setting.id} value={setting.value} />}
        {!!item.detail && <p className="type-body text-muted-foreground text-pretty">{item.detail}</p>}
        {!!item.code && <pre className="max-h-48 overflow-auto rounded-md bg-muted px-2.5 py-1.5 font-mono type-caption whitespace-pre-wrap">{item.code}</pre>}
        {item.tool?.options?.map((o) => (
          <Field key={o.id} orientation="horizontal">
            <Checkbox id={`${item.id}-${o.id}`} checked={options.includes(o.id)} onCheckedChange={(on) => toggle(o.id, on === true)} />
            <FieldLabel htmlFor={`${item.id}-${o.id}`} className="font-normal break-all">
              {o.label}
            </FieldLabel>
          </Field>
        ))}
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2 border-t-0 bg-transparent pt-0">
        <Button variant="outline" size="sm" onClick={() => decide(false)}>
          {deny}
        </Button>
        <Button variant={kind === 'delete' ? 'danger' : 'default'} size="sm" onClick={() => decide(true, options)}>
          {approve}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The setting's real control twice, read-only: as it is now, and as it would be. */
function SettingChange({ id, value }: { id: WidgetSettingKey; value: string }) {
  const current = settingValue(usePrefs(), id);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-32 flex-1 type-body">{WIDGET_SETTINGS[id].label}</span>
      <span className="flex items-center gap-2">
        <ReadOnlyControl id={id} value={current} label={`Now: ${optionLabel(id, current)}`} className="text-muted-foreground" />
        <ArrowRight aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
        <ReadOnlyControl id={id} value={value} label={`Proposed: ${optionLabel(id, value)}`} />
      </span>
    </div>
  );
}

const READ_ONLY = 'disabled:cursor-default disabled:opacity-100';

function ReadOnlyControl({ id, value, label, className }: { id: WidgetSettingKey; value: string; label: string; className?: string }) {
  if (isSwitch(id)) return <Switch checked={value === 'true'} disabled aria-label={label} className={READ_ONLY} />;
  return <SettingsSelect value={value} options={WIDGET_SETTINGS[id].options} onChange={() => {}} disabled aria-label={label} className={cn('w-auto max-w-44', READ_ONLY, className)} />;
}

/**
 * A tool widget answers the waiting call; a setting a blocked call pointed at (no call waits on it) is applied here and
 * closes with its record.
 */
function useDecision(item: QueueItem) {
  const { dispatch } = useHarness();
  const prefs = usePrefs();
  return (isApproved: boolean, options?: string[]) => {
    if (item.tool) return decideTool(item.tool.callId, { isApproved, options });
    if (!item.setting || !isWidgetSetting(item.setting.id)) return dispatch({ type: 'card-record', queueId: item.id, text: 'Dismissed' });
    const { id, suggested = '' } = item.setting;
    const { label } = WIDGET_SETTINGS[id];
    const patch = isApproved && settingPatch(id, suggested);
    if (patch) setPrefs(patch);
    dispatch({ type: 'card-record', queueId: item.id, text: patch ? `Set ${label} to ${optionLabel(id, suggested)}` : `Kept ${label}: ${optionLabel(id, settingValue(prefs, id))}` });
  };
}

/** Opens the widget's thread, then scrolls the widget into view and focuses it, so Esc and Tab act on it straight away. */
export function useShowCard() {
  const { dispatch } = useHarness();
  return (item: QueueItem) => {
    dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } });
    let tries = 0;
    // Timers, not rAF: frames pause while the window is hidden, and the thread mounts a beat after `go`.
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(item.id)}"]`);
      if (!el) return void (++tries < 60 && setTimeout(find, 16));
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    };
    setTimeout(find, 16);
  };
}
