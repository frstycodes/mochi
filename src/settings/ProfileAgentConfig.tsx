import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useState, type ReactNode } from 'react';
import { Info } from '@/icons';
import { toast } from '@/toast/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { host } from '../host';
import type { ConfigPreview } from '../host/types/settings';
import type { Provider, Space } from '../model';
import { useHarness, useView } from '../store';
import { parseServerCommand, parseServerJson, toClaude, type ConfigChange, type McpServerDef } from './agentConfig';
import { ipcMessage } from './AgentSettings';
import { FileDiffs } from './FileDiffs';
import { HARNESSES } from './harnesses';
import { SettingsRow } from './parts';

export type Review = (title: string, changes: ConfigChange[]) => Promise<boolean>;

/** The profile's config files, read again when the window regains focus; nothing is read without a profile. */
export function useProfileConfig(spaceId: string | undefined) {
  const { state } = useHarness();
  const view = useView(spaceId);
  const projectRoot = (view.kind === 'thread' && state.threads.find((t) => t.id === view.id)?.repo?.path) || undefined;
  const configQuery = useQuery({ queryKey: queryKeys.profile.config.root(spaceId, projectRoot), queryFn: () => host.settings.agentConfig(spaceId!, projectRoot), enabled: !!spaceId, staleTime: 0 });
  return { config: configQuery.data, error: configQuery.error ? `Couldn't read this profile's agent config: ${ipcMessage(configQuery.error)}` : undefined, reload: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.profile.config.space(spaceId) }); } };
}

/** `review` previews the edits, waits for the user in the diff dialog, writes, and resolves true once written. */
export function useConfigWriter(spaceId: string, onWritten: () => void) {
  const [pending, setPending] = useState<{ title: string; changes: ConfigChange[]; preview: ConfigPreview; resolve: (ok: boolean) => void } | null>(null);
  const [isWriting, setWriting] = useState(false);
  const review: Review = (title, changes) =>
    host.settings.previewConfig(spaceId, changes).then(
      (preview) => new Promise<boolean>((resolve) => setPending({ title, changes, preview, resolve })),
      (e: Error) => (toast.error('Couldn’t prepare the change', { description: ipcMessage(e) }), false),
    );
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const write = () => {
    if (!pending) return;
    setWriting(true);
    const befores = Object.fromEntries(pending.preview.edits.map((e) => [e.path, e.before]));
    host.settings
      .applyConfig(spaceId, pending.changes, befores)
      .then(
        ({ backupDir }) => {
          toast('Saved', { description: backupDir ? `The old files are in ${backupDir}` : undefined });
          close(true);
          onWritten();
        },
        (e: Error) => toast.error('Nothing was written', { description: ipcMessage(e) }),
      )
      .finally(() => setWriting(false));
  };
  const dialog = <ReviewDialog pending={pending} isWriting={isWriting} onWrite={write} onCancel={() => close(false)} />;
  return { review, dialog };
}

// {ROWS}

/** An MCP server an agent suggested, in Settings' add form as JSON (so its env and headers come along), until it's added. */
export function SuggestedServerRow({ profile, provider, server, children }: { profile: Space; provider: Provider; server: McpServerDef; children?: ReactNode }) {
  const { config, reload } = useProfileConfig(profile.id);
  const { review, dialog } = useConfigWriter(profile.id, reload);
  const taken = config?.[provider].mcpServers.map((s) => s.def.name) ?? [];
  const isAdded = taken.includes(server.name);
  return (
    <SettingsRow label={`Add MCP server ${server.name}`} description={`${HARNESSES[provider].name}, ${profile.name}`}>
      {isAdded ? (
        <p className="type-meta text-muted-foreground">Added. It shows in Settings › Profiles with the others.</p>
      ) : (
        <AddServerForm provider={provider} taken={taken} review={review} onDone={reload} initialJson={JSON.stringify({ mcpServers: { [server.name]: toClaude(server) } }, null, 2)} />
      )}
      {children}
      {dialog}
    </SettingsRow>
  );
}

function AddServerForm({ provider, taken, review, onDone, initialJson }: { provider: Provider; taken: string[]; review: Review; onDone: () => void; initialJson?: string }) {
  const [mode, setMode] = useState<'command' | 'json'>(initialJson ? 'json' : 'command');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [json, setJson] = useState(initialJson ?? '');
  const [error, setError] = useState<string>();
  const submit = async () => {
    let servers;
    try {
      servers = mode === 'json' ? parseServerJson(json) : [parseServerCommand(name.trim(), command)];
    } catch (e) {
      return setError((e as Error).message);
    }
    setError(undefined);
    const replaces = servers.filter((s) => taken.includes(s.name)).map((s) => s.name);
    const title = replaces.length ? `Replace ${replaces.join(', ')}` : `Add ${servers.map((s) => s.name).join(', ')}`;
    if (await review(title, servers.map((server) => ({ kind: 'mcp-set', provider, server })))) onDone();
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
        <ToggleGroupItem value="command">Command</ToggleGroupItem>
        <ToggleGroupItem value="json">JSON</ToggleGroupItem>
      </ToggleGroup>
      {mode === 'command' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Server name" placeholder="github" value={name} onChange={(e) => setName(e.target.value)} className="sm:w-36" autoFocus />
          <Input aria-label="Command or URL" placeholder="npx -y @modelcontextprotocol/server-github, or https://…" value={command} onChange={(e) => setCommand(e.target.value)} className="flex-1 font-mono" spellCheck={false} />
        </div>
      ) : (
        <Textarea aria-label="Servers as JSON" placeholder={'{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] } } }'} value={json} onChange={(e) => setJson(e.target.value)} className="min-h-28 font-mono text-xs" spellCheck={false} autoFocus />
      )}
      {!!error && <p className="type-caption text-destructive">{error}</p>}
      <p className="type-caption text-muted-foreground">Put secrets in your environment and write them as {'${VAR}'}: the tool reads them at start, and the file never holds them.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="outline" size="sm">
          Review…
        </Button>
      </div>
    </form>
  );
}

// {PARTS}

function ReviewDialog({ pending, isWriting, onWrite, onCancel }: { pending: { title: string; preview: ConfigPreview } | null; isWriting: boolean; onWrite: () => void; onCancel: () => void }) {
  const preview = pending?.preview;
  const isEmpty = !!preview && !preview.edits.length && !preview.copies.length;
  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && !isWriting && onCancel()}>
      {!!pending && !!preview && (
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{pending.title}</DialogTitle>
            <DialogDescription>{isEmpty ? 'Nothing to change.' : 'Mochi backs each file up to ~/.harness/backups before writing.'}</DialogDescription>
          </DialogHeader>
          <div className="-mx-6 flex min-h-0 flex-col gap-3 overflow-y-auto px-6">
            {!!preview.notes.length && (
              <Alert>
                <Info />
                <AlertDescription>
                  <ul className="flex flex-col gap-1">
                    {preview.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <FileDiffs edits={preview.edits} />
            {preview.copies.map((c) => (
              <p key={c.to} className="type-meta [overflow-wrap:anywhere]">
                Copies the skill folder <span className="font-mono text-xs">{c.from}</span> to <span className="font-mono text-xs">{c.to}</span>
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel} disabled={isWriting}>
              {isEmpty ? 'Close' : 'Cancel'}
            </Button>
            {!isEmpty && (
              <Button onClick={onWrite} disabled={isWriting}>
                {isWriting ? 'Writing…' : writeLabel(preview)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

const PLURAL = new Intl.PluralRules('en');
const countLabel = (n: number, noun: string) => `${n} ${PLURAL.select(n) === 'one' ? noun : `${noun}s`}`;
const writeLabel = ({ edits, copies }: ConfigPreview) => [edits.length && `Write ${countLabel(edits.length, 'file')}`, copies.length && `copy ${countLabel(copies.length, 'skill')}`].filter(Boolean).join(', ').replace(/^c/, 'C');
