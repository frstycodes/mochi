import { clearUiStorage, uiStorageEntries } from '../../lib/uiStorage.ts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash } from '@/icons';
import { toast } from '@/toast/store';
import { formatBytes } from '@mochi/domain/lib/format';
import { Button } from '@/components/ui/button';
import { plural } from '@mochi/domain/lib/format';
import { PINS_STORAGE_KEY, replaceAllPins, useAllPins } from '../../chat/pins';
import { useConfirm } from '../../git/useConfirm';
import { host } from '../../host';
import { forgetAllReplays } from '../../replay/recorder';
import { useHarness } from '../../store';
import { SIDECHAT_STORAGE_KEY } from '../../store/sidechat';
import { TERMINAL_STORAGE_PREFIX } from '../../terminal/storage';
import {
  SettingsGroup,
  SettingsRow,
  settingControlId,
  UNDO_MS,
} from '../parts';
import { CatalogRow } from '../CatalogRow';
import { queryKeys } from '../../queryKeys';

/** What Mochi keeps on this computer, by what clearing it would remove, then the switches for demo data and replays. */
export function DataSection() {
  const { state, dispatch } = useHarness();
  const { confirm, dialog } = useConfirm();
  const { usage, remeasure } = useStorageUsage();
  const replays = useReplayUsage();

  const clearPins = () => {
    const previous = replaceAllPins({});
    toast('Pins cleared', {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => replaceAllPins(previous) },
    });
  };
  const clearSideChats = () => {
    const previous = state.sidechats;
    dispatch({ type: 'sidechat-replace', sidechats: {} });
    toast('Side chats cleared', {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () =>
          dispatch({ type: 'sidechat-replace', sidechats: previous }),
      },
    });
  };
  const clearTerminals = async () => {
    const { clearTerminalHistory } = await import('../../terminal/sessions');
    clearTerminalHistory();
    remeasure();
    toast('Terminal history cleared', {
      description: 'Open shells keep running.',
    });
  };
  const clearReplays = async () => {
    const isConfirmed = await confirm({
      title: 'Delete every replay recording?',
      description:
        'Threads stay as they are, but Replay can only show what they do from now on.',
      confirm: 'Delete recordings',
      cancel: 'Keep recordings',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    forgetAllReplays();
    await host.data.clearReplays().catch((error: unknown) =>
      toast.error('Couldn’t delete the recordings', {
        description: String(error),
      }),
    );
    replays.remeasure();
  };
  const clearEverything = async () => {
    const isConfirmed = await confirm({
      title: 'Clear everything Mochi stores here?',
      description:
        'Pins, side chats, terminal history, layouts, address history and every preference go back to their defaults, and Mochi reloads. Agent accounts and API keys stay.',
      confirm: 'Clear and reload',
      cancel: 'Keep my data',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    const clear = clearUiStorage;
    clear();
    // Open terminals save their scrollback on pagehide; this listener runs after theirs and wipes it again.
    addEventListener('pagehide', clear);
    location.reload();
  };

  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup
        id="storage"
        title="Stored on this computer"
        footer={`${formatBytes(usage.total)} in all. Pins and side chats can be undone right after clearing.`}
      >
        <ClearRow
          id="clearPins"
          label="Pins"
          area={usage.pins}
          onClear={clearPins}
        />
        <ClearRow
          id="clearSideChats"
          label="Side chats"
          area={usage.sidechats}
          onClear={clearSideChats}
        />
        <ClearRow
          id="clearTerminals"
          label="Terminal history"
          area={usage.terminals}
          onClear={clearTerminals}
        />
      </SettingsGroup>
      <SettingsGroup
        id="replay"
        title="Developer"
        footer="Turning recording off keeps what's already recorded."
      >
        {host.isDesktop && <CatalogRow settingKey="demoData" />}
        <CatalogRow settingKey="recordReplays" />
        <ClearRow
          id="clearReplays"
          label="Replay recordings"
          area={replays.usage}
          onClear={() => void clearReplays()}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Start over"
        footer="Agent accounts and API keys stay."
      >
        <SettingsRow
          id="clearEverything"
          label="Clear everything"
          description="Pins, side chats, terminal history, layouts and every setting go back to their defaults, and Mochi reloads"
          control={
            <Button
              id={settingControlId('clearEverything')}
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void clearEverything()}
            >
              <Trash data-icon="inline-start" />
              Clear everything
            </Button>
          }
        />
      </SettingsGroup>
      {dialog}
    </div>
  );
}

function ClearRow({
  id,
  label,
  area,
  onClear,
}: {
  id: string;
  label: string;
  area: Area;
  onClear: () => void;
}) {
  return (
    <SettingsRow
      id={id}
      label={label}
      description={
        area.items
          ? `${area.items} ${area.noun(area.items)} · ${formatBytes(area.bytes)}`
          : 'Nothing stored'
      }
      control={
        <Button
          id={settingControlId(id)}
          variant="outline"
          size="sm"
          disabled={!area.items}
          onClick={onClear}
        >
          Clear
        </Button>
      }
    />
  );
}

interface Area {
  items: number;
  bytes: number;
  noun: (n: number) => string;
}

const noun = (one: string, other: string) => (n: number) =>
  plural(n, one, other);
// Browser storage keeps UTF-16: two bytes a character, keys included.
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
  const messageCount = Object.values(state.sidechats).reduce(
    (n, tabs) =>
      n + Object.values(tabs).reduce((m, chat) => m + chat.messages.length, 0),
    0,
  );
  const usage = {
    pins: {
      items: pinCount,
      bytes: storedBytes(PINS_STORAGE_KEY, JSON.stringify(pins)),
      noun: noun('pin', 'pins'),
    } satisfies Area,
    sidechats: {
      items: messageCount,
      bytes: storedBytes(SIDECHAT_STORAGE_KEY, JSON.stringify(state.sidechats)),
      noun: noun('message', 'messages'),
    } satisfies Area,
    terminals: {
      items: 0,
      bytes: 0,
      noun: noun('terminal', 'terminals'),
    } satisfies Area,
    total: 0,
  };
  try {
    for (const [key, raw] of uiStorageEntries()) {
      if (key === PINS_STORAGE_KEY || key === SIDECHAT_STORAGE_KEY) continue;
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
  const usageQuery = useQuery({
    queryKey: queryKeys.usage.replays(),
    queryFn: () => host.data.replayUsage(),
  });
  const usage = usageQuery.data ?? { threads: 0, bytes: 0 };
  return {
    usage: {
      items: usage.threads,
      bytes: usage.bytes,
      noun: noun('thread', 'threads'),
    } satisfies Area,
    remeasure: () => {
      void usageQuery.refetch();
    },
  };
}

function terminalCount(raw: string): number {
  try {
    const saved = JSON.parse(raw);
    return (saved?.state?.value ?? saved)?.sessions?.length ?? 0;
  } catch {
    return 0;
  }
}
