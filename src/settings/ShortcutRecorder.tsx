import { useEffect, useRef, useState } from 'react';
import { RotateLeft } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { checkBinding, chordOf, COMMANDS, defaultKeys, isCustom, rebind, type CommandId, type OnConflict } from '../keymap';
import type { Key } from '../keys';
import { Shortcut, useBinding } from '../Shortcut';
import { TooltipIconButton } from '../ui';
import { getPrefs, setPrefs, usePrefs } from './prefs';

type Recording = { kind: 'idle' } | { kind: 'recording'; refused?: { keys: Key[]; reason: string } } | { kind: 'conflict'; keys: Key[]; with: CommandId };

/**
 * A command's chord in Settings › Keyboard and the settings widget: click to record (Esc cancels, Backspace clears), a
 * reserved chord is refused with the reason, and a clash asks whether to swap or replace before anything is saved.
 */
export function ShortcutRecorder({ id, command }: { id: string; command: CommandId }) {
  const keys = useBinding(command);
  const hasCustom = isCustom(command, usePrefs().keybindings);
  const [state, setState] = useState<Recording>({ kind: 'idle' });

  const assign = (next: Key[] | null, onConflict?: OnConflict) => {
    const check = checkBinding(command, next, getPrefs().keybindings);
    if (check.ok || onConflict) {
      setPrefs({ keybindings: rebind(getPrefs().keybindings, command, next, onConflict) });
      return setState({ kind: 'idle' });
    }
    setState('reason' in check ? { kind: 'recording', refused: { keys: next!, reason: check.reason } } : { kind: 'conflict', keys: next!, with: check.conflict });
  };

  useRecording(state.kind === 'recording', {
    onCancel: () => setState({ kind: 'idle' }),
    onClear: () => assign(null),
    onChord: (chord) => assign(chord),
  });

  return (
    <div className="flex items-center gap-1">
      {hasCustom && (
        <TooltipIconButton label="Reset" hint={<>Back to <Shortcut keys={defaultKeys(command)} /></>} onClick={() => assign(defaultKeys(command))} className="text-muted-foreground">
          <RotateLeft />
        </TooltipIconButton>
      )}
      <Popover open={state.kind !== 'idle'} onOpenChange={(isOpen) => setState(isOpen ? { kind: 'recording' } : { kind: 'idle' })}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" size="sm" aria-label={`Change the shortcut for ${COMMANDS[command].title}`} className="min-w-24 justify-center">
            {state.kind === 'recording' ? <span className="text-muted-foreground">Press keys…</span> : keys ? <Shortcut keys={keys} /> : <span className="text-muted-foreground">None</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-3 p-3" onOpenAutoFocus={(e) => state.kind === 'recording' && e.preventDefault()}>
          {state.kind === 'conflict' ? (
            <Conflict keys={keys} next={state.keys} holder={state.with} onCancel={() => setState({ kind: 'idle' })} onSettle={(how) => assign(state.keys, how)} />
          ) : (
            <>
              {state.kind === 'recording' && state.refused ? (
                <p className="type-body text-pretty">
                  <Shortcut keys={state.refused.keys} /> can't be used. <span className="text-warning">{state.refused.reason}.</span>
                </p>
              ) : (
                <p className="type-body text-pretty">Press the new shortcut for {COMMANDS[command].title}.</p>
              )}
              <p className="flex flex-wrap items-center gap-1 type-caption text-muted-foreground">
                <Shortcut keys={['Esc']} /> cancels, <Shortcut keys={['Backspace']} /> removes it
              </p>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Conflict({ keys, next, holder, onCancel, onSettle }: { keys: Key[] | null; next: Key[]; holder: CommandId; onCancel: () => void; onSettle: (how: OnConflict) => void }) {
  const title = COMMANDS[holder].title;
  return (
    <>
      <p className="type-body text-pretty">
        <Shortcut keys={next} /> is already used by <span className="font-medium">{title}</span>.
      </p>
      <p className="type-caption text-muted-foreground text-pretty">
        {keys ? (
          <>
            Swap gives {title} <Shortcut keys={keys} />. Replace leaves it without a shortcut.
          </>
        ) : (
          `Replace leaves ${title} without a shortcut.`
        )}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={keys ? 'outline' : 'default'} size="sm" onClick={() => onSettle('replace')}>
          Replace
        </Button>
        {!!keys && (
          <Button size="sm" autoFocus onClick={() => onSettle('swap')}>
            Swap
          </Button>
        )}
      </div>
    </>
  );
}

/** While recording, every key press is the recorder's: captured on `window` before the app's own shortcuts and Radix's Esc. */
function useRecording(isRecording: boolean, on: { onCancel: () => void; onClear: () => void; onChord: (keys: Key[]) => void }) {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => {
    if (!isRecording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const isBare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (isBare && e.key === 'Escape') return latest.current.onCancel();
      if (isBare && e.key === 'Backspace') return latest.current.onClear();
      const chord = chordOf(e);
      if (chord) latest.current.onChord(chord);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isRecording]);
}
