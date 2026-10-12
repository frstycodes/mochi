import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MultiFileDiff } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { Add, Download, Flash, FolderOpen, InfoCircle, Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { host } from '../host';
import type { ConfigPreview, ProfileConfig, ProviderConfig } from '../host/types/settings';
import type { Provider, Space } from '../model';
import { useProfiles, updateProfile } from '../profiles';
import { useHarness, useView } from '../store';
import { OverflowIcon } from '../ui';
import { INSTRUCTIONS_FILE, parseServerCommand, parseServerJson, serverSummary, type ConfigChange, type McpEntry } from './agentConfig';
import { ipcMessage } from './AgentSettings';
import { HARNESS_IDS, HARNESSES } from './harnesses';
import { takeRequestedHarness, useSettingsRoute } from './open';
import { usePrefs } from './prefs';
import { SettingsRow } from './parts';

/**
 * A profile's instructions, MCP servers and skills, read from and written to its accounts' own config files so Claude
 * Code and Codex load them natively. Every write is shown as a diff first and backed up.
 */
export function AgentConfigRows({ profile }: { profile: Space }) {
  const { config, error, reload } = useProfileConfig(profile.id);
  const { review, dialog } = useConfigWriter(profile.id, reload);
  if (error) return <SettingsRow label="Agent setup" description={<span className="text-destructive">{error}</span>} />;
  return (
    <>
      <InstructionsRow profile={profile} config={config} review={review} />
      <McpRow profile={profile} config={config} review={review} />
      <SkillsRow profile={profile} config={config} review={review} />
      <ImportRow profile={profile} review={review} />
      {dialog}
    </>
  );
}

type Review = (title: string, changes: ConfigChange[]) => Promise<boolean>;

function useProfileConfig(spaceId: string) {
  const { state } = useHarness();
  const view = useView(spaceId);
  const projectRoot = (view.kind === 'thread' && state.threads.find((t) => t.id === view.id)?.repo?.path) || undefined;
  const [config, setConfig] = useState<ProfileConfig>();
  const [error, setError] = useState<string>();
  const reload = useCallback(
    () =>
      host.settings.agentConfig(spaceId, projectRoot).then(
        (next) => (setConfig(next), setError(undefined)),
        (e: Error) => setError(`Couldn't read this profile's agent config: ${ipcMessage(e)}`),
      ),
    [spaceId, projectRoot],
  );
  useEffect(() => {
    void reload();
    // The tools write these files too (`claude mcp add`, `/skills`), so coming back to the window re-reads them.
    addEventListener('focus', reload);
    return () => removeEventListener('focus', reload);
  }, [reload]);
  return { config, error, reload };
}

/** `review` previews the edits, waits for the user in the diff dialog, writes, and resolves true once written. */
function useConfigWriter(spaceId: string, onWritten: () => void) {
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

function InstructionsRow({ profile, config, review }: { profile: Space; config?: ProfileConfig; review: Review }) {
  const isSynced = !!profile.syncInstructions;
  const [provider, setProvider] = useState<Provider>('claude');
  const [drafts, setDrafts] = useState<Partial<Record<Provider, string>>>({});
  const shown = isSynced ? 'claude' : provider;
  const saved = config?.[shown].instructions.text ?? '';
  const text = drafts[shown] ?? saved;
  const isEdited = drafts[shown] !== undefined && drafts[shown] !== saved;
  const differs = !!config && config.claude.instructions.text !== config.codex.instructions.text;
  const save = async () => {
    const targets = isSynced ? HARNESS_IDS : [provider];
    const isWritten = await review(`Save ${targets.map((p) => INSTRUCTIONS_FILE[p]).join(' and ')}`, targets.map((p) => ({ kind: 'instructions', provider: p, text })));
    if (isWritten) setDrafts({});
  };
  const project = config?.[shown].projectInstructions;
  return (
    <ExpandRow
      id={`${profile.id}-instructions`}
      label="Instructions"
      description={!config ? 'Reading…' : isSynced ? 'CLAUDE.md and AGENTS.md, kept the same' : HARNESS_IDS.map((p) => `${INSTRUCTIONS_FILE[p]} ${lineCount(config[p].instructions.text)}`).join(' · ')}
    >
      {!isSynced && <HarnessPicker value={provider} onChange={setProvider} />}
      <Textarea
        aria-label={`${INSTRUCTIONS_FILE[shown]} for ${profile.name}`}
        value={text}
        onChange={(e) => setDrafts((d) => ({ ...d, [shown]: e.target.value }))}
        placeholder={`No ${INSTRUCTIONS_FILE[shown]} yet. What should every ${HARNESSES[shown].name} session in ${profile.name} know?`}
        spellCheck={false}
        className="max-h-96 min-h-40 font-mono text-xs leading-5"
      />
      <p className="type-caption text-muted-foreground [overflow-wrap:anywhere]">
        {isSynced ? `${config?.claude.instructions.path ?? ''} and ${config?.codex.instructions.path ?? ''}` : config?.[shown].instructions.path}
        {!!project && `. The project adds ${project}.`}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex flex-1 items-center gap-2 type-meta">
          <Switch checked={isSynced} onCheckedChange={(on) => updateProfile(profile.id, { syncInstructions: on })} />
          Keep CLAUDE.md and AGENTS.md the same
        </label>
        {isEdited && (
          <Button variant="ghost" size="sm" onClick={() => setDrafts({})}>
            Discard edits
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={!config || (!isEdited && !(isSynced && differs))} onClick={() => void save()}>
          {isSynced && differs && !isEdited ? 'Sync files…' : 'Review and save…'}
        </Button>
      </div>
      {isSynced && differs && <p className="type-caption text-warning">The two files differ. Saving writes this text (from CLAUDE.md) to both.</p>}
    </ExpandRow>
  );
}

function McpRow({ profile, config, review }: { profile: Space; config?: ProfileConfig; review: Review }) {
  const rowId = `${profile.id}-mcp`;
  const [provider, setProvider] = useRequestedHarness(rowId);
  const [isAdding, setAdding] = useState(false);
  const current = config?.[provider];
  const other = HARNESS_IDS.find((p) => p !== provider)!;
  return (
    <ExpandRow id={rowId} label="MCP servers" description={!config ? 'Reading…' : HARNESS_IDS.map((p) => `${countLabel(config[p].mcpServers.filter((s) => s.scope === 'user').length, 'server')} on ${HARNESSES[p].name}`).join(' · ')}>
      <HarnessPicker value={provider} onChange={setProvider} />
      {!!current && <AccountNote config={current} />}
      {!!current?.mcpServers.length && (
        <ul className="flex flex-col gap-1">
          {current.mcpServers.map((server) => (
            <McpServerItem key={`${server.scope}-${server.def.name}`} spaceId={profile.id} provider={provider} server={server} review={review} />
          ))}
        </ul>
      )}
      {current && !current.mcpServers.length && <p className="type-meta text-muted-foreground">No MCP servers on this account yet.</p>}
      {isAdding && <AddServerForm provider={provider} taken={current?.mcpServers.map((s) => s.def.name) ?? []} review={review} onDone={() => setAdding(false)} />}
      <div className="flex flex-wrap gap-2">
        {!isAdding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Add data-icon="inline-start" />
            Add server
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void review(`Import MCP servers from ${HARNESSES[other].name}`, [{ kind: 'import', from: { spaceId: profile.id, provider: other }, provider, parts: ['mcp'] }])}>
          <Download data-icon="inline-start" />
          Import from {HARNESSES[other].name}
        </Button>
      </div>
    </ExpandRow>
  );
}

function McpServerItem({ spaceId, provider, server, review }: { spaceId: string; provider: Provider; server: McpEntry; review: Review }) {
  const { def, enabled, scope, needs } = server;
  const [test, setTest] = useState<{ state: 'running' } | { state: 'ok'; tools: string[] } | { state: 'failed'; error: string }>();
  const isProject = scope === 'project';
  const run = () => {
    setTest({ state: 'running' });
    host.settings.testMcp(spaceId, provider, def.name).then(
      ({ tools }) => setTest({ state: 'ok', tools }),
      (e: Error) => setTest({ state: 'failed', error: ipcMessage(e) }),
    );
  };
  return (
    <li>
      <Item variant="muted" size="xs" className="flex-wrap">
        <ItemContent className="min-w-0">
          <ItemTitle className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate">{def.name}</span>
            {isProject && <Badge variant="outline">Project</Badge>}
            {needs.map((v) => (
              <Badge key={v} variant="outline" className="text-warning">
                Needs {v}
              </Badge>
            ))}
          </ItemTitle>
          <ItemDescription className="truncate font-mono text-xs" title={serverSummary(def)}>
            {serverSummary(def)}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label={`${def.name} on`}
            checked={enabled}
            disabled={isProject}
            onCheckedChange={(on) => void review(`${on ? 'Turn on' : 'Turn off'} ${def.name}`, [{ kind: 'mcp-enabled', provider, name: def.name, enabled: on }])}
          />
          {!isProject && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${def.name} actions`}>
                  <OverflowIcon vertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={run}>
                  <Flash />
                  Test connection
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => void review(`Remove ${def.name}`, [{ kind: 'mcp-remove', provider, name: def.name }])}>
                  <Trash3 />
                  Remove server
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </ItemActions>
        {!!test && <TestResult test={test} />}
      </Item>
    </li>
  );
}

function TestResult({ test }: { test: { state: 'running' } | { state: 'ok'; tools: string[] } | { state: 'failed'; error: string } }) {
  if (test.state === 'running') return <p className="basis-full type-caption text-muted-foreground">Starting the server…</p>;
  if (test.state === 'failed') return <p className="basis-full font-mono text-xs whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{test.error}</p>;
  return (
    <div className="flex basis-full flex-col gap-1">
      <p className="type-caption text-success">Connected, {countLabel(test.tools.length, 'tool')}</p>
      {!!test.tools.length && (
        <ul className="flex flex-wrap gap-1">
          {test.tools.map((t) => (
            <li key={t}>
              <Badge variant="secondary" className="font-mono">
                {t}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddServerForm({ provider, taken, review, onDone }: { provider: Provider; taken: string[]; review: Review; onDone: () => void }) {
  const [mode, setMode] = useState<'command' | 'json'>('command');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [json, setJson] = useState('');
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
      <ToggleGroup type="single" size="sm" variant="outline" spacing={1} value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
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

function SkillsRow({ profile, config, review }: { profile: Space; config?: ProfileConfig; review: Review }) {
  const rowId = `${profile.id}-skills`;
  const [provider, setProvider] = useRequestedHarness(rowId);
  const current = config?.[provider];
  const other = HARNESS_IDS.find((p) => p !== provider)!;
  const importFolder = () =>
    host.fs.pickFolder(current?.instructions.path).then(
      (folder) => folder && void review(`Import ${folder.split(/[\\/]/).pop()}`, [{ kind: 'skill-import', provider, folder }]),
      (e: Error) => toast.error('Could not open the folder picker', { description: e.message }),
    );
  return (
    <ExpandRow id={rowId} label="Skills" description={!config ? 'Reading…' : HARNESS_IDS.map((p) => `${countLabel(config[p].skills.length, 'skill')} on ${HARNESSES[p].name}`).join(' · ')}>
      <HarnessPicker value={provider} onChange={setProvider} />
      {!!current && <AccountNote config={current} />}
      {!!current?.skills.length && (
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {current.skills.map((skill) => (
            <li key={skill.dir}>
              <Item variant="muted" size="xs">
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate">{skill.name}</ItemTitle>
                  {!!skill.description && <ItemDescription className="truncate">{skill.description}</ItemDescription>}
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label={`${skill.name} on`}
                    checked={skill.enabled}
                    onCheckedChange={(on) => void review(`${on ? 'Turn on' : 'Turn off'} ${skill.name}`, [{ kind: 'skill-enabled', provider, name: skill.name, enabled: on }])}
                  />
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      )}
      {current && !current.skills.length && <p className="type-meta text-muted-foreground">No skills on this account yet.</p>}
      {!!current?.plugins.length && <p className="type-caption text-muted-foreground">Plugins (managed in {HARNESSES[provider].name}): {current.plugins.join(', ')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void importFolder()} disabled={!host.isDesktop}>
          <FolderOpen data-icon="inline-start" />
          Import folder…
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void review(`Import skills from ${HARNESSES[other].name}`, [{ kind: 'import', from: { spaceId: profile.id, provider: other }, provider, parts: ['skills'] }])}>
          <Download data-icon="inline-start" />
          Import from {HARNESSES[other].name}
        </Button>
      </div>
    </ExpandRow>
  );
}

const ALL_PARTS: ['instructions', 'mcp', 'skills'] = ['instructions', 'mcp', 'skills'];

function ImportRow({ profile, review }: { profile: Space; review: Review }) {
  const others = useProfiles().filter((p) => p.id !== profile.id);
  const between = (from: Provider, to: Provider): ConfigChange => ({ kind: 'import', from: { spaceId: profile.id, provider: from }, provider: to, parts: ALL_PARTS });
  const fromProfile = (other: Space) => HARNESS_IDS.map((provider): ConfigChange => ({ kind: 'import', from: { spaceId: other.id, provider }, provider, parts: ALL_PARTS }));
  return (
    <SettingsRow
      label="Import"
      description="Copies instructions, MCP servers and skills this profile lacks. Secrets stay behind."
      control={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download data-icon="inline-start" />
              Import from…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {HARNESS_IDS.map((from) => {
                const to = HARNESS_IDS.find((p) => p !== from)!;
                return (
                  <DropdownMenuItem key={from} onSelect={() => void review(`Import from ${HARNESSES[from].name} into ${HARNESSES[to].name}`, [between(from, to)])}>
                    {HARNESSES[from].name}, into {HARNESSES[to].name}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            {!!others.length && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Another profile</DropdownMenuLabel>
                {others.map((other) => (
                  <DropdownMenuItem key={other.id} onSelect={() => void review(`Import from ${other.name}`, fromProfile(other))}>
                    {other.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}

// {PARTS}

/** A row whose editor opens under it; a deep link to the row opens it too. */
function ExpandRow({ id, label, description, children }: { id: string; label: string; description: ReactNode; children: ReactNode }) {
  const route = useSettingsRoute();
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    if (route?.settingId === id) setOpen(true);
  }, [route?.nonce, route?.settingId, id]);
  return (
    <SettingsRow
      id={id}
      label={label}
      description={description}
      control={
        <Button id={`setting-${id}`} variant="outline" size="sm" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
          {isOpen ? 'Done' : 'Edit'}
        </Button>
      }
    >
      {isOpen && <div className="flex min-w-0 flex-col gap-2.5">{children}</div>}
    </SettingsRow>
  );
}

function useRequestedHarness(rowId: string) {
  const route = useSettingsRoute();
  const [provider, setProvider] = useState<Provider>('claude');
  useEffect(() => {
    if (route?.settingId !== rowId) return;
    const requested = takeRequestedHarness();
    if (requested) setProvider(requested);
  }, [route?.nonce, route?.settingId, rowId]);
  return [provider, setProvider] as const;
}

function HarnessPicker({ value, onChange }: { value: Provider; onChange: (provider: Provider) => void }) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" spacing={1} value={value} onValueChange={(v) => v && onChange(v as Provider)}>
      {HARNESS_IDS.map((id) => (
        <ToggleGroupItem key={id} value={id}>
          {HARNESSES[id].name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Which account the list belongs to: edits land in that account, so every profile linked to it sees them. */
function AccountNote({ config }: { config: ProviderConfig }) {
  return (
    <>
      <p className="type-caption text-muted-foreground">
        {config.account.name} account{config.account.configDir ? ` in ${config.account.configDir}` : ''}. Changes apply to every profile on this account.
      </p>
      {!!config.error && <p className="type-caption text-destructive">{config.error}</p>}
    </>
  );
}

function ReviewDialog({ pending, isWriting, onWrite, onCancel }: { pending: { title: string; preview: ConfigPreview } | null; isWriting: boolean; onWrite: () => void; onCancel: () => void }) {
  const { resolvedTheme } = useTheme();
  const { diffStyle } = usePrefs();
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
                <InfoCircle />
                <AlertDescription>
                  <ul className="flex flex-col gap-1">
                    {preview.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {preview.edits.map((e) => (
              <section key={e.path} className="flex flex-col gap-1.5">
                <h4 className="flex items-center gap-2 type-meta text-muted-foreground [overflow-wrap:anywhere]">
                  {e.path}
                  {!e.before && <Badge variant="outline">New file</Badge>}
                </h4>
                <div className="overflow-hidden rounded-xl border bg-card">
                  <MultiFileDiff
                    oldFile={{ name: e.path, contents: e.before }}
                    newFile={{ name: e.path, contents: e.after }}
                    disableWorkerPool
                    options={{ diffStyle, disableFileHeader: true, overflow: 'wrap', themeType: resolvedTheme === 'light' ? 'light' : 'dark' }}
                    style={{ '--diffs-font-family': 'var(--font-mono)', '--diffs-font-size': '12px', '--diffs-line-height': '20px' } as React.CSSProperties}
                    className="max-h-80 overflow-auto"
                  />
                </div>
              </section>
            ))}
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
const lineCount = (text: string) => (text.trim() ? countLabel(text.trimEnd().split('\n').length, 'line') : 'empty');
const writeLabel = ({ edits, copies }: ConfigPreview) => [edits.length && `Write ${countLabel(edits.length, 'file')}`, copies.length && `copy ${countLabel(copies.length, 'skill')}`].filter(Boolean).join(', ').replace(/^c/, 'C');
