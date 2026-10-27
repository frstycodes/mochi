import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { host } from '../host';
import { gitError } from '../git/useGit';
import type { FollowedMachine, TerminalChunk } from '../host/types/remote';
import type { Thread } from '../model';
import { onThemeChange, terminalTheme } from '../terminal/theme';
import { useMachines } from './useMachines';

/**
 * A shell on the machine in the thread's folder, opened for this pane and closed with it. The machine pushes its output as it
 * prints (resuming after a dropped link, in main); keystrokes go out in order, batched while one write is on its way.
 */
export default function RemoteTerminal({
  machine,
  thread,
}: {
  machine: FollowedMachine;
  thread: Thread;
}) {
  const { ask } = useMachines();
  const boxRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorInactiveStyle: 'none',
      minimumContrastRatio: 4.5,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(boxRef.current!);
    fit.fit();
    const offTheme = onThemeChange(
      () => (term.options.theme = terminalTheme()),
    );
    const at = { threadId: thread.id };
    let terminalId: string | undefined;
    let isClosed = false;
    let typed = '';
    let isWriting = false;
    const flush = async () => {
      if (isWriting || !typed || !terminalId) return;
      isWriting = true;
      const data = typed;
      typed = '';
      await ask(machine.id, {
        type: 'terminal-write',
        ...at,
        terminalId,
        data,
      }).catch((e: unknown) => setError(gitError(e)));
      isWriting = false;
      void flush();
    };
    term.onData((data) => {
      typed += data;
      void flush();
    });
    term.onResize(
      ({ cols, rows }) =>
        terminalId &&
        void ask(machine.id, {
          type: 'terminal-resize',
          ...at,
          terminalId,
          cols,
          rows,
        }).catch(() => {}),
    );
    const observer = new ResizeObserver(
      () => boxRef.current!.clientWidth > 0 && fit.fit(),
    );
    observer.observe(boxRef.current!);
    // The first chunks can beat the open's reply, so they wait for the id they belong to.
    const early: TerminalChunk[] = [];
    const show = (chunk: TerminalChunk) => {
      if (chunk.terminalId !== terminalId) return;
      if (chunk.data) term.write(chunk.data);
      if (chunk.exitCode !== undefined)
        term.write(
          `\r\n\x1b[2m[process exited with ${chunk.exitCode}]\x1b[0m\r\n`,
        );
    };
    const offOutput = host.remote.onTerminalOutput((chunk) => {
      if (chunk.machineId !== machine.id) return;
      if (terminalId === undefined) early.push(chunk);
      else show(chunk);
    });
    void ask(machine.id, {
      type: 'terminal-open',
      ...at,
      cols: term.cols,
      rows: term.rows,
    }).then(
      (opened) => {
        terminalId = opened.terminalId;
        if (isClosed)
          return void ask(machine.id, {
            type: 'terminal-close',
            ...at,
            terminalId,
          }).catch(() => {});
        term.focus();
        early.splice(0).forEach(show);
      },
      (e: unknown) => setError(gitError(e)),
    );
    return () => {
      isClosed = true;
      offOutput();
      observer.disconnect();
      offTheme();
      term.dispose();
      if (terminalId)
        void ask(machine.id, {
          type: 'terminal-close',
          ...at,
          terminalId,
        }).catch(() => {});
    };
  }, [ask, machine.id, thread.id]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2">
      <div ref={boxRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" />
      {!!error && <p className="type-caption text-destructive">{error}</p>}
      <p className="type-caption text-subtle-foreground">
        A shell on {machine.name}, in this thread’s folder. It closes with this
        pane.
      </p>
    </div>
  );
}
