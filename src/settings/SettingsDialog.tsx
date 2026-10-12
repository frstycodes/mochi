import { useState, type ReactNode } from 'react';
import { Check, Copy3, InfoCircle, Refresh, TickCircle, Trash3, Warning } from 'reicon-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { host } from '../host';
import { CONCURRENCY_RANGE, type AgentSettings } from '../host/types/settings';
import { SPACES, type Provider } from '../model';
import { ProviderMark, SpaceIcon, TooltipIconButton } from '../ui';
import { openSettings, useSettingsOpen } from './open';
import { planMatches } from './parse';
import { useAgentSettings, type InstallState } from './useAgentSettings';

type Agent = ReturnType<typeof useAgentSettings>;

/** A dialog, not a page: it opens over whichever split you're in, and adds no view kind for the layout tree to handle. */
export function SettingsDialog() {
  const isOpen = useSettingsOpen();
  const agent = useAgentSettings(isOpen);
  return (
    <Dialog open={isOpen} onOpenChange={openSettings}>
      <DialogContent className="max-h-[min(85vh,760px)] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Agent installs, logins and limits</DialogDescription>
        </DialogHeader>
        <ScrollArea type="scroll" className="min-h-0">
          <div className="flex flex-col gap-8 px-5 pb-6">{host.isDesktop ? <AgentsSection agent={agent} /> : <WebNotice />}</div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

const PROVIDER = {
  claude: {
    name: 'Claude Code',
    login: 'claude auth login',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://code.claude.com/docs/en/setup',
    modelHint: 'claude-opus-5-5',
  },
  codex: {
    name: 'Codex',
    login: 'codex login',
    install: 'npm install -g @openai/codex',
    docs: 'https://learn.chatgpt.com/docs/codex/cli',
    modelHint: "Codex's own default",
  },
} satisfies Record<Provider, unknown>;

function AgentsSection({ agent }: { agent: Agent }) {
  return (
    <>
      <p className="type-meta text-muted-foreground">
        Harness runs your own Claude Code and Codex with the login you set up in them. It never signs in for you and never sees your credentials.
      </p>
      {(['claude', 'codex'] as const).map((provider) => (
        <InstallSection key={provider} provider={provider} install={agent.installs[provider]} settings={agent.settings} onCheck={() => agent.check(provider)} onUpdate={agent.update} />
      ))}
      <ApiKeySection agent={agent} />
      {!!agent.settings && <ConcurrencyField settings={agent.settings} onUpdate={agent.update} />}
      <SpaceLogins installs={agent.installs} />
    </>
  );
}

function InstallSection({ provider, install, settings, onCheck, onUpdate }: { provider: Provider; install: InstallState; settings?: AgentSettings; onCheck: () => void; onUpdate: Agent['update'] }) {
  const meta = PROVIDER[provider];
  const detected = install === 'checking' ? undefined : install;
  const pathKey = provider === 'claude' ? 'claudePath' : 'codexPath';
  const modelKey = provider === 'claude' ? 'claudeModel' : 'codexModel';
  return (
    <section aria-label={meta.name} className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <ProviderMark provider={provider} size={20} />
        <div className="min-w-0 flex-1">
          <h3 className="type-title">
            {meta.name}
            {!!detected?.version && <span className="ml-1.5 font-normal text-muted-foreground tabular">{detected.version}</span>}
          </h3>
          {!!detected?.path && <p className="truncate font-mono type-caption text-muted-foreground">{detected.path}</p>}
        </div>
        <LoginBadge install={install} />
        <TooltipIconButton label="Check again" hint={`Asks ${meta.name} for its version and login`} onClick={onCheck} disabled={install === 'checking'}>
          <Refresh />
        </TooltipIconButton>
      </div>
      {!!detected && <NextStep provider={provider} install={detected} onCheck={onCheck} />}
      {!!settings && (
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <CommitField
            id={`${provider}-path`}
            label="Executable"
            description="Leave empty to use the one on your PATH."
            value={settings[pathKey]}
            placeholder="Found on your PATH"
            onCommit={(value) => onUpdate({ [pathKey]: value })}
            className="font-mono placeholder:font-sans"
          />
          <CommitField
            id={`${provider}-model`}
            label="Default model"
            description="New threads start on this model."
            value={settings[modelKey]}
            placeholder={meta.modelHint}
            onCommit={(value) => onUpdate({ [modelKey]: value })}
          />
        </FieldGroup>
      )}
    </section>
  );
}

function LoginBadge({ install }: { install: InstallState }) {
  if (install === 'checking')
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

/** What the user does in their own terminal to fix a missing install or a signed-out one. Never a login form. */
function NextStep({ provider, install, onCheck }: { provider: Provider; install: Exclude<InstallState, 'checking'>; onCheck: () => void }) {
  const meta = PROVIDER[provider];
  if (install.path && install.login.state === 'logged-in') return null;
  const isMissing = !install.path;
  const isUnknown = !isMissing && install.login.state === 'unknown';
  return (
    <Alert>
      <InfoCircle />
      <AlertTitle>{isMissing ? `${meta.name} isn't installed` : isUnknown ? `Couldn't read ${meta.name}'s login` : `${meta.name} is signed out`}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        {isUnknown && install.login.state === 'unknown' && <p>{install.login.reason}</p>}
        <p>
          {isMissing ? (
            <>
              Install it in a terminal (or see{' '}
              <a href={meta.docs} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                the setup guide
              </a>
              ), sign in, then check again. If it's installed somewhere unusual, set its path below.
            </>
          ) : (
            'Sign in from a terminal, in the tool itself, then check again.'
          )}
        </p>
        <CommandLine command={isMissing ? meta.install : meta.login} />
        <Button variant="outline" size="sm" onClick={onCheck}>
          <Refresh data-icon="inline-start" />
          Check again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function CommandLine({ command }: { command: string }) {
  const [isCopied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="flex w-full items-center gap-1 rounded-lg bg-muted py-0.5 pr-0.5 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-mono type-meta text-foreground">{command}</code>
      <TooltipIconButton label={isCopied ? 'Copied' : 'Copy command'} hint="Paste it into a terminal" onClick={copy}>
        {isCopied ? <Check /> : <Copy3 />}
      </TooltipIconButton>
    </div>
  );
}

function ApiKeySection({ agent }: { agent: Agent }) {
  const [draft, setDraft] = useState('');
  const { apiKey } = agent;
  const save = async () => {
    if (await agent.saveApiKey(draft)) setDraft('');
  };
  return (
    <section aria-label="Claude API key" className="flex flex-col gap-3">
      <div>
        <h3 className="type-title">
          Claude API key <span className="font-normal text-muted-foreground">optional</span>
        </h3>
        <p className="type-meta text-muted-foreground">
          For using Claude without a Claude Code login. Harness hands it to Claude Code as <code className="font-mono">ANTHROPIC_API_KEY</code>, which makes Claude bill your API account instead of
          your Claude subscription, even if Claude Code is signed in. It's kept in your OS keychain and never shown here again.
        </p>
      </div>
      {apiKey?.isSet ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 type-body">
            Key set, ending in <span className="font-mono">{apiKey.last4}</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => void agent.saveApiKey(null)}>
            <Trash3 data-icon="inline-start" />
            Remove key
          </Button>
        </div>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            aria-label="Claude API key"
            autoComplete="off"
            spellCheck={false}
            placeholder={apiKey?.canStore === false ? 'Needs the OS keychain' : 'sk-ant-…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={apiKey?.canStore === false}
            className="font-mono"
          />
          <Button type="submit" variant="outline" disabled={!draft.trim()}>
            Save key
          </Button>
        </form>
      )}
    </section>
  );
}

function ConcurrencyField({ settings, onUpdate }: { settings: AgentSettings; onUpdate: Agent['update'] }) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="concurrency">Agents running at once</FieldLabel>
        <FieldDescription>Each Claude thread is its own Claude Code process; threads past the limit wait their turn. Codex threads share one process.</FieldDescription>
      </FieldContent>
      <Input
        id="concurrency"
        key={settings.concurrency}
        type="number"
        inputMode="numeric"
        min={CONCURRENCY_RANGE.min}
        max={CONCURRENCY_RANGE.max}
        defaultValue={settings.concurrency}
        onBlur={(e) => {
          const value = Number(e.target.value);
          if (value !== settings.concurrency) void onUpdate({ concurrency: value });
        }}
        className="w-20 tabular"
      />
    </Field>
  );
}

/** Text input that saves on blur or Enter, so typing a path doesn't re-run detection per keystroke. */
function CommitField({ id, label, description, value, placeholder, onCommit, className }: { id: string; label: string; description: string; value: string; placeholder: string; onCommit: (value: string) => void; className?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        spellCheck={false}
        onBlur={(e) => e.target.value.trim() !== value && onCommit(e.target.value.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={className}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}

function SpaceLogins({ installs }: { installs?: Agent['installs'] }) {
  return (
    <section aria-label="Logins by space" className="flex flex-col gap-3">
      <div>
        <h3 className="type-title">Logins by space</h3>
        <p className="type-meta text-muted-foreground">Which plan each space expects. Every space uses the same installs for now; separate logins per space come later.</p>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-0.5">
        {SPACES.map((space) => (
          <li key={space.id} className="col-span-3 grid grid-cols-subgrid items-center py-1">
            <span className="flex min-w-0 items-center gap-2 type-body">
              <SpaceIcon space={space} className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{space.name}</span>
            </span>
            {(['claude', 'codex'] as const).map((provider) => (
              <ExpectedPlan key={provider} provider={provider} expected={space.accounts[provider]} install={installs?.[provider]} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExpectedPlan({ provider, expected, install }: { provider: Provider; expected: string; install?: InstallState }) {
  const match = install && install !== 'checking' ? planMatches(expected, install.login) : undefined;
  const reported = install && install !== 'checking' && install.login.state === 'logged-in' ? install.login.plan : undefined;
  return (
    <span className="flex items-center gap-1.5 type-meta">
      <ProviderMark provider={provider} size={14} />
      <span className="text-muted-foreground">{expected}</span>
      {match === true && <TickCircle aria-label="Matches the install" className="size-3.5 text-success" />}
      {match === false && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Warning aria-hidden className="size-3.5 text-warning" />
          <span className="truncate">install: {reported}</span>
        </span>
      )}
    </span>
  );
}

function WebNotice() {
  return (
    <>
      <Alert>
        <InfoCircle />
        <AlertTitle>Agent settings need the desktop app</AlertTitle>
        <AlertDescription>
          Detecting your Claude Code and Codex installs, storing an API key and the concurrency limit only work in the Harness desktop app. Here, threads run on the demo agents, so everything else
          keeps working.
        </AlertDescription>
      </Alert>
      <SpaceLogins />
    </>
  );
}
