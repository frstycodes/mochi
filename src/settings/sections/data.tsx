import { useCallback, useEffect, useState } from 'react';
import { Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PINS_STORAGE_KEY, replaceAllPins, useAllPins } from '../../chat/pins';
import { useConfirm } from '../../git/useConfirm';
import { host } from '../../host';
import { forgetAllReplays } from '../../replay/recorder';
import { useHarness } from '../../store';
import { SIDECHAT_STORAGE_KEY } from '../../store/sidechat';
import { clearTerminalHistory, TERMINAL_STORAGE_PREFIX } from '../../terminal/sessions';
import { SettingsGroup, SettingsRow, settingControlId, UNDO_MS } from '../parts';
import { setPrefs, usePrefs } from '../prefs';
import pkg from '../../../package.json';

/** What Mochi keeps in this window's local storage, by what clearing it would remove. */
export function DataSection() {
  const { state, dispatch } = useHarness();
  const { confirm, dialog } = useConfirm();
  const { usage, remeasure } = useStorageUsage();
  const { demoData, recordReplays } = usePrefs();
  const replays = useReplayUsage();

  const clearPins = () => {
    const previous = replaceAllPins({});
    toast('Pins cleared', { duration: UNDO_MS, action: { label: 'Undo', onClick: () => replaceAllPins(previous) } });
  };
  const clearSideChats = () => {
    const previous = state.sidechats;
    dispatch({ type: 'sidechat-replace', sidechats: {} });
    toast('Side chats cleared', { duration: UNDO_MS, action: { label: 'Undo', onClick: () => dispatch({ type: 'sidechat-replace', sidechats: previous }) } });
  };
  const clearTerminals = () => {
    clearTerminalHistory();
    remeasure();
    toast('Terminal history cleared', { description: 'Open shells keep running.' });
  };
  const clearReplays = async () => {
    const isConfirmed = await confirm({
      title: 'Delete every replay recording?',
      description: 'Threads stay as they are, but Replay can only show what they do from now on.',
      confirm: 'Delete recordings',
      cancel: 'Keep recordings',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    forgetAllReplays();
    await host.data.clearReplays().catch((error: unknown) => toast.error('Couldn’t delete the recordings', { description: String(error) }));
    replays.remeasure();
  };
  const clearEverything = async () => {
    const isConfirmed = await confirm({
      title: 'Clear everything Mochi stores here?',
      description: 'Pins, side chats, terminal history, layouts, address history and every preference on this page go back to their defaults, and Mochi reloads. Agent accounts and API keys stay.',
      confirm: 'Clear and reload',
      cancel: 'Keep my data',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    const clear = () => {
      try {
        localStorage.clear();
      } catch {}
    };
    clear();
    // Open terminals save their scrollback on pagehide; this listener runs after theirs and wipes it again.
    addEventListener('pagehide', clear);
    location.reload();
  };

  return (
    <div className="flex flex-col gap-8">
      {host.isDesktop && (
        <SettingsGroup footer="Sample threads, queue items and profiles from the prototype, shown next to your own. They never run an agent and aren't saved. Mochi reloads to apply.">
          <SettingsRow id="demoData" label="Show demo data" control={<Switch id={settingControlId('demoData')} checked={demoData} onCheckedChange={setDemoData} />} />
        </SettingsGroup>
      )}
      <SettingsGroup
        id="replay"
        title="Replay"
        footer="Each of your threads keeps its agent's events, with your messages and answers, so Replay can rebuild it step by step. Up to 8 MB per thread; turning this off keeps what's already recorded."
      >
        <SettingsRow id="recordReplays" label="Record threads for replay" control={<Switch id={settingControlId('recordReplays')} checked={recordReplays} onCheckedChange={(isOn) => setPrefs({ recordReplays: isOn })} />} />
        <ClearRow id="clearReplays" label="Recordings" area={replays.usage} onClear={() => void clearReplays()} />
      </SettingsGroup>
      <SettingsGroup id="storage" title="Stored on this computer" footer={`${formatBytes(usage.total)} in all. Pins and side chats can be undone right after clearing.`}>
        <ClearRow id="clearPins" label="Pins" area={usage.pins} onClear={clearPins} />
        <ClearRow id="clearSideChats" label="Side chats" area={usage.sidechats} onClear={clearSideChats} />
        <ClearRow id="clearTerminals" label="Terminal history" area={usage.terminals} onClear={clearTerminals} />
        <SettingsRow
          id="clearEverything"
          label="Everything"
          description="Resets this page too"
          control={
            <Button id={settingControlId('clearEverything')} variant="outline" size="sm" onClick={() => void clearEverything()}>
              <Trash3 data-icon="inline-start" className="text-destructive" />
              Clear everything
            </Button>
          }
        />
      </SettingsGroup>
      <SettingsGroup id="about" title="About">
        <SettingsRow label="Mochi" control={<span className="type-meta text-muted-foreground tabular">{pkg.version}</span>} />
        {host.isDesktop && <SettingsRow label="Electron" control={<span className="type-meta text-muted-foreground tabular">{engineVersion('Electron')}</span>} />}
        <SettingsRow label="Chromium" control={<span className="type-meta text-muted-foreground tabular">{engineVersion('Chrome') || 'Not Chromium'}</span>} />
        <SettingsRow
          label="Docs"
          control={
            <div className="flex gap-3 type-meta">
              {DOCS.map((d) => (
                <a key={d.href} href={d.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {d.label}
                </a>
              ))}
            </div>
          }
        />
      </SettingsGroup>
      {dialog}
    </div>
  );
}

/** The store reads demo data once at startup; your own threads are saved before the reload (`beforeunload`). */
function setDemoData(isOn: boolean) {
  setPrefs({ demoData: isOn });
  location.reload();
}

function ClearRow({ id, label, area, onClear }: { id: string; label: string; area: Area; onClear: () => void }) {
  return (
    <SettingsRow
      id={id}
      label={label}
      description={area.items ? `${area.items} ${area.noun(area.items)} · ${formatBytes(area.bytes)}` : 'Nothing stored'}
      control={
        <Button id={settingControlId(id)} variant="outline" size="sm" disabled={!area.items} onClick={onClear}>
          Clear
        </Button>
      }
    />
  );
}

const REPO = 'https://github.com/frstycodes/mochi/blob/main';
const DOCS = [
  { label: 'README', href: `${REPO}/README.md` },
  { label: 'Runtime', href: `${REPO}/RUNTIME.md` },
  { label: 'Settings', href: `${REPO}/SETTINGS.md` },
];

interface Area {
  items: number;
  bytes: number;
  noun: (n: number) => string;
}

const PLURAL = new Intl.PluralRules('en');
const noun = (one: string, other: string) => (n: number) => (PLURAL.select(n) === 'one' ? one : other);
// localStorage keeps UTF-16: two bytes a character, keys included.
const storedBytes = (key: string, raw: string) => (key.length + raw.length) * 2;

/**
 * What each area holds and its size. Pins and side chats are measured from their live stores, since side chats reach
 * storage in an effect that runs after this section renders; terminal scrollback only changes on clear or pagehide.
 */
function useStorageUsage() {
  const { state } = useHarness();
  const pins = useAllPins();
  const [, setRevision] = useState(0);
  const pinCount = Object.values(pins).reduce((n, list) => n + list.length, 0);
  const messageCount = Object.values(state.sidechats).reduce((n, tabs) => n + Object.values(tabs).reduce((m, chat) => m + chat.messages.length, 0), 0);
  const usage = {
    pins: { items: pinCount, bytes: storedBytes(PINS_STORAGE_KEY, JSON.stringify(pins)), noun: noun('pin', 'pins') } satisfies Area,
    sidechats: { items: messageCount, bytes: storedBytes(SIDECHAT_STORAGE_KEY, JSON.stringify(state.sidechats)), noun: noun('message', 'messages') } satisfies Area,
    terminals: { items: 0, bytes: 0, noun: noun('terminal', 'terminals') } satisfies Area,
    total: 0,
  };
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === PINS_STORAGE_KEY || key === SIDECHAT_STORAGE_KEY) continue;
      const raw = localStorage.getItem(key) ?? '';
      usage.total += storedBytes(key, raw);
      if (!key.startsWith(TERMINAL_STORAGE_PREFIX)) continue;
      usage.terminals.bytes += storedBytes(key, raw);
      usage.terminals.items += terminalCount(raw);
    }
  } catch {}
  usage.total += usage.pins.bytes + usage.sidechats.bytes;
  return { usage, remeasure: () => setRevision((r) => r + 1) };
}

/** Recordings live in main's data folder, not local storage; read again after clearing. */
function useReplayUsage() {
  const [usage, setUsage] = useState({ threads: 0, bytes: 0 });
  const remeasure = useCallback(() => {
    host.data.replayUsage().then(setUsage, (error: unknown) => console.error('Reading replay storage failed', error));
  }, []);
  useEffect(remeasure, [remeasure]);
  return { usage: { items: usage.threads, bytes: usage.bytes, noun: noun('thread', 'threads') } satisfies Area, remeasure };
}

function terminalCount(raw: string): number {
  try {
    return JSON.parse(raw)?.sessions?.length ?? 0;
  } catch {
    return 0;
  }
}

const BYTES = new Intl.NumberFormat('en', { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 });

function formatBytes(bytes: number) {
  return BYTES.format(bytes / 1024);
}

function engineVersion(name: string) {
  return navigator.userAgent.match(new RegExp(`${name}/([\\d.]+)`))?.[1] ?? '';
}
