import { useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Cursor,
  Flag,
  Globe,
  Hand,
  Keyboard,
  MessageQuestion,
  Settings,
  ShieldCheck,
  Trash,
  type IconComponent,
} from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import {
  authorName,
  settingRef,
  type ActivityEntry,
  type EventGlyph,
  type QueueItem,
  type SettingsSuggestion,
  type Space,
} from '../model';
import { Favicon } from '../WebLinks';
import { host } from '../host';
import { useProfiles } from '../profiles';
import { clock } from '../progress';
import { AgentSettingsProvider } from '../settings/AgentSettings';
import { findSetting, settingsCatalog, valueLabel } from '../settings/catalog';
import {
  CatalogRow,
  isConfigKey,
  useSettingSources,
} from '../settings/CatalogRow';
import { FileDiffs } from '../settings/FileDiffs';
import { SettingsRow } from '../settings/parts';
import { SuggestedServerRow } from '../settings/ProfileAgentConfig';
import { useHarness, useDispatch } from '../store';
import { MessageResponse } from '@/components/ai-elements/message';
import { FLUSH } from '../viz/CodeFrame';
import { revealCard } from './Transcript';
import { QuestionWidget } from '../QueueView';

/** A Mochi widget where the agent asked: the live card while it waits, then its one-line record. */
export function CardEntry({
  entry,
  card,
}: {
  entry: ActivityEntry;
  card: NonNullable<ActivityEntry['card']>;
}) {
  const { state } = useHarness();
  const item = card.isOpen
    ? state.queue.find((q) => q.id === card.id)
    : undefined;
  if (item?.settings)
    return <SettingsWidget item={item} settings={item.settings} />;
  if (item?.kind === 'question') return <QuestionWidget item={item} />;
  if (item) return <MochiWidget item={item} />;
  // Open with no card behind it: Mochi quit while it waited, and the call ended with it.
  return (
    <EventLine
      text={
        card.isOpen
          ? `Not answered before Mochi quit: ${entry.text}`
          : entry.text
      }
      at={entry.at}
      glyph={entry.glyph}
      site={entry.site}
    />
  );
}

export function EventLine({
  text,
  detail,
  at,
  glyph,
  site,
}: {
  text: string;
  detail?: string;
  at: number;
  glyph?: EventGlyph;
  site?: string;
}) {
  const Icon = glyph ? GLYPHS[glyph] : Flag;
  const host = site && hostOf(site);
  return (
    <div className="flex gap-2 type-caption text-muted-foreground">
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      {/* Anything unbroken (a long name, a host) wraps inside the chat's width instead of pushing past it. */}
      <p className="min-w-0 [overflow-wrap:anywhere]">
        {text}
        {!!host && (
          <>
            {' on '}
            <span className="text-foreground" title={site}>
              <Favicon
                host={host}
                fallback={<Globe className="size-3 text-subtle-foreground" />}
                className="mr-1 inline-flex size-3 align-[-2px]"
              />
              {host}
            </span>
          </>
        )}
        {/* The separator travels with the time, so a wrap never leaves it dangling. */}
        <span className="whitespace-nowrap tabular text-subtle-foreground">
          {' '}
          · {clock(at)}
        </span>
        {!!detail && (
          <span className="block text-subtle-foreground">{detail}</span>
        )}
      </p>
    </div>
  );
}

const GLYPHS = {
  click: Cursor,
  type: Keyboard,
  browse: Globe,
} satisfies Record<EventGlyph, IconComponent>;

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

const KIND = {
  delete: {
    icon: Trash,
    label: "Can't be undone",
    approve: 'Delete',
    deny: 'Cancel',
  },
  confirm: {
    icon: ShieldCheck,
    label: 'Approval',
    approve: 'Allow',
    deny: 'Deny',
  },
  choose: {
    icon: MessageQuestion,
    label: 'Question',
    approve: 'Continue',
    deny: 'Cancel',
  },
  handoff: { icon: Hand, label: 'Your turn', approve: 'Done', deny: 'Cancel' },
} satisfies Record<
  string,
  { icon: IconComponent; label: string; approve: string; deny: string }
>;

/** A call waiting on you: a delete, a browser escalation, a question with one answer, or a handoff. Enter works on whichever button has focus; Esc anywhere inside says no. */
export function MochiWidget({ item }: { item: QueueItem }) {
  const [options, setOptions] = useState<string[]>([]);
  const kind = item.tool?.isDestructive
    ? 'delete'
    : item.tool?.pick === 'one'
      ? 'choose'
      : item.tool?.isHandoff
        ? 'handoff'
        : 'confirm';
  const { icon: Icon, label, approve, deny } = KIND[kind];
  const dispatch = useDispatch();
  const decide = (isApproved: boolean, chosen?: string[]) =>
    dispatch({
      type: 'tool-decision',
      queueId: item.id,
      isApproved,
      ...(chosen && { options: chosen }),
    });
  const toggle = (id: string, on: boolean) =>
    setOptions((o) => (on ? [...o, id] : o.filter((x) => x !== id)));
  return (
    <WidgetCard item={item} onEscape={() => decide(false)}>
      <CardHeader className="gap-2">
        {/* A plain approval needs no label: the title says what it does, the buttons that it asks. */}
        {kind !== 'confirm' && (
          <CardDescription
            className={cn(
              'flex items-center gap-1 type-meta font-medium',
              kind === 'delete' ? 'text-destructive' : 'text-foreground',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </CardDescription>
        )}
        <CardTitle className="type-body font-medium text-pretty [overflow-wrap:anywhere]">
          {item.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!!item.detail && (
          <p className="type-meta text-muted-foreground text-pretty [overflow-wrap:anywhere]">
            {item.detail}
          </p>
        )}
        {!!item.tool?.notes?.length && (
          <ul className="flex flex-col gap-1 type-meta text-muted-foreground">
            {item.tool.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {!!item.tool?.edits && <FileDiffs edits={item.tool.edits} />}
        {!!item.code && <CodePreview code={item.code} />}
        {kind === 'choose' && (
          <RadioGroup
            value={options[0] ?? ''}
            onValueChange={(v) => setOptions([v])}
            aria-label={item.title}
            className="gap-2"
          >
            {item.tool?.options?.map((o) => (
              <Field key={o.id} orientation="horizontal">
                <RadioGroupItem id={`${item.id}-${o.id}`} value={o.id} />
                <FieldLabel
                  htmlFor={`${item.id}-${o.id}`}
                  className="font-normal break-all"
                >
                  {o.label}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        )}
        {kind !== 'choose' &&
          item.tool?.options?.map((o) => (
            <Field key={o.id} orientation="horizontal">
              <Checkbox
                id={`${item.id}-${o.id}`}
                checked={options.includes(o.id)}
                onCheckedChange={(on) => toggle(o.id, on === true)}
              />
              <FieldLabel
                htmlFor={`${item.id}-${o.id}`}
                className="font-normal break-all"
              >
                {o.label}
              </FieldLabel>
            </Field>
          ))}
      </CardContent>
      {/* Like every chat widget: left-aligned, the yes first. */}
      <CardFooter className="flex-wrap justify-start gap-2 border-t-0 bg-transparent pt-0">
        <Button
          variant={kind === 'delete' ? 'danger' : 'default'}
          size="sm"
          className="type-meta"
          disabled={kind === 'choose' && !options.length}
          onClick={() => decide(true, options)}
        >
          {approve}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="type-meta"
          onClick={() => decide(false)}
        >
          {deny}
        </Button>
      </CardFooter>
    </WidgetCard>
  );
}

/**
 * What the call runs, always shown and highlighted like a code block in the chat: an approval is a decision about this code.
 * Past a few lines it's cut, with the rest one click away, so a long script never pushes the answers off screen.
 */
function CodePreview({ code }: { code: string }) {
  const [isFull, setFull] = useState(false);
  const lines = code.split('\n');
  const isLong = lines.length > PREVIEW_LINES;
  const isCut = isLong && !isFull;
  // One line more than the preview, so the fade lands on code rather than on padding.
  const shown = isCut ? lines.slice(0, PREVIEW_LINES + 1).join('\n') : code;
  return (
    <div className="group/code relative overflow-hidden rounded-lg border bg-muted/40">
      <div
        className={cn(
          FLUSH,
          '[&_[data-streamdown=code-block-body]]:px-3 [&_[data-streamdown=code-block-body]]:py-2',
          lines.length > 1 &&
            '[&_code>span]:before:mr-3 [&_code>span]:before:w-[2ch]',
          isCut && 'mask-[linear-gradient(to_bottom,black_45%,transparent)]',
          isFull && 'max-h-72 overflow-y-auto',
        )}
      >
        {/* One line needs no numbering; more get a gutter only as wide as their digits. */}
        <MessageResponse lineNumbers={lines.length > 1}>
          {fenced(shown, CODE_LANGUAGE)}
        </MessageResponse>
      </div>
      {isCut && (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setFull(true)}
          className="absolute inset-x-0 bottom-0 flex h-14 cursor-pointer items-end justify-center pb-2 focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          <span className={REVEALED_PILL}>
            {`Show full code · ${lines.length - PREVIEW_LINES} more lines`}
          </span>
        </button>
      )}
      {isFull && isLong && (
        <button
          type="button"
          aria-expanded
          onClick={() => setFull(false)}
          className={cn(
            REVEALED_PILL,
            'absolute right-2 bottom-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          Collapse
        </button>
      )}
    </div>
  );
}

/** Shown while the code is hovered or the control has focus; an opaque pill so it reads over the code beneath. */
const REVEALED_PILL =
  'rounded-full border bg-popover px-2.5 py-0.5 type-caption text-muted-foreground shadow-sm opacity-0 transition-opacity group-hover/code:opacity-100 [:focus-visible>&]:opacity-100 focus-visible:opacity-100 hover:text-foreground pointer-coarse:opacity-100';

/** A markdown fence around the code, longer than any backtick run inside it so the code can't close it early. */
function fenced(code: string, language: string) {
  const longest = Math.max(
    2,
    ...(code.match(/`+/g) ?? []).map((m) => m.length),
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}

// GAP: approvals don't say what language their code is in; nearly all are shell commands, so they're highlighted as bash.
const CODE_LANGUAGE = 'bash';

const PREVIEW_LINES = 4;

function WidgetCard({
  item,
  onEscape,
  children,
}: {
  item: QueueItem;
  onEscape: () => void;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onEscape();
  };
  return (
    <Card
      size="sm"
      data-card={item.id}
      tabIndex={-1}
      role="group"
      aria-label={item.title}
      onKeyDown={onKeyDown}
      // Transparent like the other chat widgets: the chat shows through and only the hairline frames it.
      className="bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </Card>
  );
}

/**
 * Suggested settings as their real Settings rows, live: every control changes the setting right away, and each row
 * carries the suggestion with Use. Nothing waits on it; Done (or Esc) closes it into a record of what changed meanwhile.
 */
function SettingsWidget({
  item,
  settings,
}: {
  item: QueueItem;
  settings: SettingsSuggestion;
}) {
  const dispatch = useDispatch();
  const profiles = useProfiles();
  const [readers] = useState(() => new Map<string, Reader>());
  const groups = [
    ...new Set(settings.changes.map((c) => c.profileId ?? '')),
  ].map(
    (profileId) =>
      [
        profileId,
        settings.changes.filter((c) => (c.profileId ?? '') === profileId),
      ] as const,
  );
  const close = async () => {
    const done = (
      await Promise.all([...readers.values()].map((read) => read()))
    ).flat();
    dispatch({
      type: 'card-record',
      queueId: item.id,
      text: done.length
        ? capitalize(LIST.format(done))
        : 'Closed the suggestion; nothing changed',
    });
  };
  return (
    <AgentSettingsProvider isDetecting={false}>
      <WidgetCard item={item} onEscape={() => void close()}>
        <CardHeader className="gap-2">
          <CardDescription className="flex items-center gap-1 type-caption font-medium text-foreground">
            <Settings aria-hidden className="size-3.5" />
            Settings
          </CardDescription>
          <CardTitle className="text-pretty">{item.title}</CardTitle>
          {!!settings.reason && (
            <p className="type-body text-muted-foreground text-pretty">
              {settings.reason}
            </p>
          )}
          {settings.by === 'harness' && !!item.detail && (
            <p className="type-body text-muted-foreground text-pretty">
              {item.detail}
            </p>
          )}
        </CardHeader>
        <CardContent className="px-0">
          {groups.map(([profileId, changes]) => (
            <SuggestionGroup
              key={profileId}
              item={item}
              profile={profiles.find((p) => p.id === profileId)}
              profileId={profileId}
              changes={changes}
              settings={settings}
              readers={readers}
            />
          ))}
          {!!settings.addServer && (
            <SuggestedServer
              server={settings.addServer}
              by={settings.by}
              readers={readers}
            />
          )}
        </CardContent>
        <CardFooter className="justify-between gap-2 border-t-0 bg-transparent pt-0">
          <p className="type-caption text-muted-foreground">
            Changes apply as you make them.
          </p>
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
function SuggestionGroup({
  item,
  profile,
  profileId,
  changes,
  settings,
  readers,
}: {
  item: QueueItem;
  profile?: Space;
  profileId: string;
  changes: SettingsSuggestion['changes'];
  settings: SettingsSuggestion;
  readers: Map<string, Reader>;
}) {
  const { sources } = useSettingSources(profile, false);
  readers.set(profileId, async () => {
    const config =
      profile && changes.some((c) => isConfigKey(c.key))
        ? await host.settings.agentConfig(profile.id).catch(() => undefined)
        : undefined;
    const now = { ...sources, config };
    const catalog = settingsCatalog({ profile, config });
    return changes.flatMap((c) => {
      const setting = findSetting(catalog, c.key);
      const value = setting?.read(now);
      if (
        !setting ||
        value === undefined ||
        value === settings.before[settingRef(c)]
      )
        return [];
      return [`set ${setting.label} to ${valueLabel(setting, value)}`];
    });
  });
  if (profileId && !profile)
    return <SettingsRow label="That profile was removed" />;
  return changes.map((c) => (
    <CatalogRow
      key={c.key}
      settingKey={c.key}
      profile={profile}
      suggestion={{ value: c.value, by: settings.by }}
      idPrefix={`${item.id}-`}
    />
  ));
}

function SuggestedServer({
  server,
  by,
  readers,
}: {
  server: NonNullable<SettingsSuggestion['addServer']>;
  by: SettingsSuggestion['by'];
  readers: Map<string, Reader>;
}) {
  const profile = useProfiles().find((p) => p.id === server.profileId);
  readers.set('addServer', async () => {
    const config = await host.settings
      .agentConfig(server.profileId)
      .catch(() => undefined);
    return config?.[server.provider].mcpServers.some(
      (s) => s.def.name === server.server.name,
    )
      ? [`added MCP server ${server.server.name}`]
      : [];
  });
  if (!profile) return <SettingsRow label="That profile was removed" />;
  return (
    <SuggestedServerRow
      profile={profile}
      provider={server.provider}
      server={server.server}
    >
      <p className="type-meta text-muted-foreground">
        Filled in by {authorName(by)}. Review it to add it; secrets stay as{' '}
        {'${VAR}'}.
      </p>
    </SuggestedServerRow>
  );
}

/** Opens the widget's thread, then scrolls the widget into view and focuses it, so Esc and Tab act on it straight away. */
export function useShowCard() {
  const dispatch = useDispatch();
  return (item: QueueItem) => {
    dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } });
    let tries = 0;
    // Timers, not rAF: frames pause while the window is hidden, and the thread mounts a beat after `go`.
    const find = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-card="${CSS.escape(item.id)}"]`,
      );
      // The transcript is virtualized: a card far up the thread has no element until its row is scrolled to.
      if (!el)
        return void (revealCard(item.id), ++tries < 60 && setTimeout(find, 16));
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    };
    setTimeout(find, 16);
  };
}
