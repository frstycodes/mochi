import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Flag, Settings, ShieldCheck, Trash, type IconComponent } from '@/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { authorName, settingRef, type ActivityEntry, type QueueItem, type SettingsSuggestion, type Space } from '../model';
import { host } from '../host';
import { useProfiles } from '../profiles';
import { clock } from '../progress';
import { decideTool } from '../runtime/tools';
import { AgentSettingsProvider } from '../settings/AgentSettings';
import { findSetting, recordValue, settingsCatalog, valueLabel } from '../settings/catalog';
import { CatalogRow, isConfigKey, useSettingSources } from '../settings/CatalogRow';
import { FileDiffs } from '../settings/FileDiffs';
import { SettingsRow } from '../settings/parts';
import { SuggestedServerRow } from '../settings/ProfileAgentConfig';
import { SuggestedConnectorRow } from '../library/ConnectDialog';
import { useHarness } from '../store';
import { revealCard } from './Transcript';

/** A Mochi widget where the agent asked: the live card while it waits, then its one-line record. */
export function CardEntry({ entry, card }: { entry: ActivityEntry; card: NonNullable<ActivityEntry['card']> }) {
  const { state } = useHarness();
  const item = card.isOpen ? state.queue.find((q) => q.id === card.id) : undefined;
  if (item?.settings) return <SettingsWidget item={item} settings={item.settings} />;
  if (item) return <MochiWidget item={item} />;
  // Open with no card behind it: Mochi quit while it waited, and the call ended with it.
  return <EventLine text={card.isOpen ? `Not answered before Mochi quit: ${entry.text}` : entry.text} at={entry.at} />;
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
  delete: { icon: Trash, label: "Can't be undone", approve: 'Delete', deny: 'Cancel' },
  confirm: { icon: ShieldCheck, label: 'Approval', approve: 'Allow', deny: 'Deny' },
} satisfies Record<string, { icon: IconComponent; label: string; approve: string; deny: string }>;

/** A call waiting on you: a delete or a browser escalation. Enter works on whichever button has focus; Esc anywhere inside says no. */
function MochiWidget({ item }: { item: QueueItem }) {
  const [options, setOptions] = useState<string[]>([]);
  const kind = item.tool?.isDestructive ? 'delete' : 'confirm';
  const { icon: Icon, label, approve, deny } = KIND[kind];
  const decide = (isApproved: boolean, chosen?: string[]) => (item.tool ? decideTool(item.tool.callId, { isApproved, options: chosen }) : undefined);
  const toggle = (id: string, on: boolean) => setOptions((o) => (on ? [...o, id] : o.filter((x) => x !== id)));
  return (
    <WidgetCard item={item} onEscape={() => decide(false)}>
      <CardHeader>
        <CardDescription className={cn('flex items-center gap-1 type-caption font-medium', kind === 'delete' ? 'text-destructive' : 'text-foreground')}>
          <Icon aria-hidden className="size-3.5" />
          {label}
        </CardDescription>
        <CardTitle className="text-pretty">{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!!item.detail && <p className="type-body text-muted-foreground text-pretty">{item.detail}</p>}
        {!!item.tool?.notes?.length && (
          <ul className="flex flex-col gap-1 type-caption text-muted-foreground">
            {item.tool.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {!!item.tool?.edits && <FileDiffs edits={item.tool.edits} />}
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
    </WidgetCard>
  );
}

function WidgetCard({ item, onEscape, children }: { item: QueueItem; onEscape: () => void; children: ReactNode }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onEscape();
  };
  return (
    <Card size="sm" data-card={item.id} tabIndex={-1} role="group" aria-label={item.title} onKeyDown={onKeyDown} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </Card>
  );
}

/**
 * Suggested settings as their real Settings rows, live: every control changes the setting right away, and each row
 * carries the suggestion with Use. Nothing waits on it; Done (or Esc) closes it into a record of what changed meanwhile.
 */
function SettingsWidget({ item, settings }: { item: QueueItem; settings: SettingsSuggestion }) {
  const { dispatch } = useHarness();
  const profiles = useProfiles();
  const readers = useRef(new Map<string, Reader>());
  const groups = [...new Set(settings.changes.map((c) => c.profileId ?? ''))].map((profileId) => [profileId, settings.changes.filter((c) => (c.profileId ?? '') === profileId)] as const);
  const close = async () => {
    const done = (await Promise.all([...readers.current.values()].map((read) => read()))).flat();
    dispatch({ type: 'card-record', queueId: item.id, text: done.length ? capitalize(LIST.format(done)) : 'Closed the suggestion; nothing changed' });
  };
  return (
    <AgentSettingsProvider isDetecting={false}>
      <WidgetCard item={item} onEscape={() => void close()}>
        <CardHeader>
          <CardDescription className="flex items-center gap-1 type-caption font-medium text-foreground">
            <Settings aria-hidden className="size-3.5" />
            Settings
          </CardDescription>
          <CardTitle className="text-pretty">{item.title}</CardTitle>
          {!!settings.reason && <p className="type-body text-muted-foreground text-pretty">{settings.reason}</p>}
          {settings.by === 'harness' && !!item.detail && <p className="type-body text-muted-foreground text-pretty">{item.detail}</p>}
        </CardHeader>
        <CardContent className="px-0">
          {groups.map(([profileId, changes]) => (
            <SuggestionGroup key={profileId} item={item} profile={profiles.find((p) => p.id === profileId)} profileId={profileId} changes={changes} settings={settings} readers={readers.current} />
          ))}
          {!!settings.addServer && <SuggestedServer server={settings.addServer} by={settings.by} readers={readers.current} />}
          {!!settings.addConnector && <SuggestedConnector connector={settings.addConnector} readers={readers.current} />}
        </CardContent>
        <CardFooter className="justify-between gap-2 border-t-0 bg-transparent pt-0">
          <p className="type-caption text-muted-foreground">Changes apply as you make them.</p>
          <Button variant="outline" size="sm" onClick={() => void close()}>
            Done
          </Button>
        </CardFooter>
      </WidgetCard>
    </AgentSettingsProvider>
  );
}

/**
 * What changed through one part of the widget since it opened, for its record. Config files are read again here: a row
 * that wrote one through the review reloads only its own copy.
 */
type Reader = () => Promise<string[]>;

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/** One profile's rows (or the app's, `profileId` ''); registers how to tell what changed since the widget opened. */
function SuggestionGroup({ item, profile, profileId, changes, settings, readers }: { item: QueueItem; profile?: Space; profileId: string; changes: SettingsSuggestion['changes']; settings: SettingsSuggestion; readers: Map<string, Reader> }) {
  const { sources } = useSettingSources(profile, false);
  readers.set(profileId, async () => {
    const config = profile && changes.some((c) => isConfigKey(c.key)) ? await host.settings.agentConfig(profile.id).catch(() => undefined) : undefined;
    const now = { ...sources, config };
    const catalog = settingsCatalog({ profile, config });
    return changes.flatMap((c) => {
      const setting = findSetting(catalog, c.key);
      const value = setting?.read(now);
      if (!setting || value === undefined || recordValue(setting, value) === settings.before[settingRef(c)]) return [];
      return [setting.control.type === 'instructions' ? `saved ${setting.label}` : `set ${setting.label} to ${valueLabel(setting, value)}`];
    });
  });
  if (profileId && !profile) return <SettingsRow label="That profile was removed" />;
  return changes.map((c) => <CatalogRow key={c.key} settingKey={c.key} profile={profile} suggestion={{ value: c.value, by: settings.by }} idPrefix={`${item.id}-`} />);
}

function SuggestedServer({ server, by, readers }: { server: NonNullable<SettingsSuggestion['addServer']>; by: SettingsSuggestion['by']; readers: Map<string, Reader> }) {
  const profile = useProfiles().find((p) => p.id === server.profileId);
  readers.set('addServer', async () => {
    const config = await host.settings.agentConfig(server.profileId).catch(() => undefined);
    return config?.[server.provider].mcpServers.some((s) => s.def.name === server.server.name) ? [`added MCP server ${server.server.name}`] : [];
  });
  if (!profile) return <SettingsRow label="That profile was removed" />;
  return (
    <SuggestedServerRow profile={profile} provider={server.provider} server={server.server}>
      <p className="type-meta text-muted-foreground">Filled in by {authorName(by)}. Review it to add it; secrets stay as {'${VAR}'}.</p>
    </SuggestedServerRow>
  );
}

function SuggestedConnector({ connector, readers }: { connector: NonNullable<SettingsSuggestion['addConnector']>; readers: Map<string, Reader> }) {
  const profile = useProfiles().find((p) => p.id === connector.profileId);
  readers.set('addConnector', async () => {
    const entries = await host.library.list(connector.profileId).catch(() => []);
    const added = entries.find((e) => e.kind === 'connector' && e.source === connector.url && e.isLinked && (!connector.alias || e.alias === connector.alias));
    return added ? [`connected ${added.title} (${added.alias})`] : [];
  });
  if (!profile) return <SettingsRow label="That profile was removed" />;
  return <SuggestedConnectorRow profile={profile} url={connector.url} alias={connector.alias} />;
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
      // The transcript is virtualized: a card far up the thread has no element until its row is scrolled to.
      if (!el) return void (revealCard(item.id), ++tries < 60 && setTimeout(find, 16));
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    };
    setTimeout(find, 16);
  };
}
