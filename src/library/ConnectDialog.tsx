import { useEffect, useState } from 'react';
import { Copy } from '@/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/toast/store';
import { host } from '../host';
import { copyText } from '../clipboard';
import { connectorFor, connectorIcon, isSameServer, OAUTH_PROVIDERS, oauthProviderFor, type DeviceCode, type OAuthProviderId } from './connectors';
import type { Space } from '../model';
import { ListIcon, SettingsRow } from '../settings/parts';
import { LibraryIcon } from './LibraryParts';
import { useLibrary, type Library } from './useLibrary';

/**
 * Adds an account on a remote MCP server: what to call it, then how it signs in. Without a `url` it's a custom server and
 * asks for the URL first. Stays open, waiting, while a browser sign-in runs.
 */
export function ConnectAccountDialog({ open, onOpenChange, url, alias, library }: { open: boolean; onOpenChange: (open: boolean) => void; url?: string; alias?: string; library: Library }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <ConnectAccountForm fixedUrl={url} initialAlias={alias} library={library} onCancel={() => onOpenChange(false)} onConnected={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** An account an agent suggested (`connect_account`), on its settings widget: Connect opens the dialog, filled in. */
export function SuggestedConnectorRow({ profile, url, alias }: { profile: Space; url: string; alias?: string }) {
  const library = useLibrary(profile.id);
  const [isOpen, setOpen] = useState(false);
  const name = connectorFor(url)?.name ?? new URL(url).hostname;
  const isConnected = !!library.entries?.some((e) => e.kind === 'connector' && e.source === url && e.isLinked && (!alias || e.alias === alias));
  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2.5">
          <ListIcon url={connectorIcon(url)} />
          Connect {name}
        </span>
      }
      description={`${alias ?? 'A new account'}, ${profile.name}`}
      control={
        isConnected ? (
          <span className="type-meta text-muted-foreground">Connected</span>
        ) : (
          <Button size="sm" onClick={() => setOpen(true)}>
            Connect
          </Button>
        )
      }
    >
      <ConnectAccountDialog open={isOpen} onOpenChange={setOpen} url={url} alias={alias} library={library} />
    </SettingsRow>
  );
}

type SignInMethod = 'oauth' | 'key' | 'app';

// Lives inside the dialog's content, which unmounts when it closes, so every opening starts fresh.
function ConnectAccountForm({ fixedUrl, initialAlias, library, onCancel, onConnected }: { fixedUrl?: string; initialAlias?: string; library: Library; onCancel: () => void; onConnected: () => void }) {
  const [typedUrl, setTypedUrl] = useState('');
  const url = fixedUrl ?? typedUrl.trim();
  const isUrlValid = URL.canParse(url) && /^https?:\/\//.test(url);
  const name = connectorFor(url)?.name ?? (isUrlValid ? new URL(url).hostname : 'a server');
  const provider = oauthProviderFor(url);
  const mochiApps = useMochiOAuthApps();
  const hasMochiApp = !!provider && !!mochiApps?.includes(provider);
  const takenAliases = (library.entries ?? []).flatMap((e) => (e.kind === 'connector' && e.alias && !!e.source && isUrlValid && isSameServer(e.source, url) ? [e.alias] : []));
  const [alias, setAlias] = useState(() => initialAlias ?? freeAlias(takenAliases));
  const [chosenMethod, setMethod] = useState<SignInMethod>('oauth');
  // Without Mochi's own app, a provider that can't register one can't sign in in the browser: its own app is the default.
  const method = provider && !hasMochiApp && chosenMethod === 'oauth' ? 'app' : chosenMethod;
  const [secret, setSecret] = useState({ apiKey: '', clientId: '', clientSecret: '' });
  const [isBusy, setBusy] = useState(false);
  const isTaken = takenAliases.includes(alias);
  const isReady = isUrlValid && !!alias && !isTaken && !isBusy && (method !== 'key' || !!secret.apiKey) && (method !== 'app' || !!secret.clientId);
  const deviceCode = useDeviceCode(isBusy ? url : null);
  const submit = () => {
    setBusy(true);
    const account = { url, alias, ...(method === 'key' && { apiKey: secret.apiKey }), ...(method === 'app' && { clientId: secret.clientId, clientSecret: secret.clientSecret }) };
    void library.addConnector(account).then((isDone) => {
      setBusy(false);
      if (!isDone) return;
      toast.success(`${name} (${alias}) connected`);
      onConnected();
    });
  };
  const methods = signInMethods(name, provider, hasMochiApp);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (isReady) submit();
      }}
    >
      <DialogHeader className="flex-row items-center gap-3">
        <LibraryIcon key={url} url={isUrlValid ? connectorIcon(url) : null} letter={fixedUrl ? name : '+'} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle>{fixedUrl ? `Connect ${name}` : 'Add a custom server'}</DialogTitle>
          <DialogDescription>{fixedUrl ? 'Its sign-in stays in this computer’s keychain.' : 'Any remote MCP server, by its URL. Its sign-in stays in this computer’s keychain.'}</DialogDescription>
        </span>
      </DialogHeader>
      {!fixedUrl && (
        <Field data-invalid={(!!typedUrl.trim() && !isUrlValid) || undefined}>
          <FieldLabel htmlFor="connect-url">Server URL</FieldLabel>
          <Input id="connect-url" autoFocus type="url" placeholder="https://mcp.example.com/mcp" value={typedUrl} onChange={(e) => setTypedUrl(e.target.value)} aria-invalid={!!typedUrl.trim() && !isUrlValid} />
          {!!typedUrl.trim() && !isUrlValid && <FieldError>Use the full address, starting with https://</FieldError>}
        </Field>
      )}
      <Field data-invalid={isTaken || undefined}>
        <FieldLabel htmlFor="connect-alias">Account name</FieldLabel>
        <Input id="connect-alias" autoFocus={!!fixedUrl} value={alias} onChange={(e) => setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} aria-invalid={isTaken} />
        {isTaken ? <FieldError>There is already a {alias} account on {name}.</FieldError> : <FieldDescription>Short, like work or personal. Agents pick the account by this name.</FieldDescription>}
      </Field>
      <RadioGroup value={method} onValueChange={(v) => setMethod(v as SignInMethod)} aria-label="How it signs in" className="gap-2">
        {(Object.keys(methods) as SignInMethod[]).map((m) => (
          <label
            key={m}
            htmlFor={`connect-${m}`}
            className="flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/40 has-data-checked:border-foreground/25 has-data-checked:bg-accent/50 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-transparent"
          >
            <RadioGroupItem id={`connect-${m}`} value={m} disabled={methods[m].isDisabled} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="type-body font-medium">{methods[m].title}</span>
              <span className="type-meta text-pretty text-muted-foreground">{methods[m].body}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {method === 'key' && (
        <Field>
          <FieldLabel htmlFor="connect-key">API key or token</FieldLabel>
          <Input id="connect-key" type="password" autoComplete="off" value={secret.apiKey} onChange={(e) => setSecret({ ...secret, apiKey: e.target.value })} />
        </Field>
      )}
      {method === 'app' && (
        <Field>
          <FieldLabel htmlFor="connect-client">OAuth app</FieldLabel>
          <Input id="connect-client" placeholder="Client ID" value={secret.clientId} onChange={(e) => setSecret({ ...secret, clientId: e.target.value })} />
          <Input type="password" autoComplete="off" aria-label="Client secret" placeholder="Client secret, if it has one" value={secret.clientSecret} onChange={(e) => setSecret({ ...secret, clientSecret: e.target.value })} />
          <FieldDescription>
            A desktop client that allows a loopback redirect (http://127.0.0.1, any port)
            {!!provider && (
              <>
                {', from '}
                <a href={OAUTH_PROVIDERS[provider].consoleUrl} target="_blank" rel="noreferrer">
                  {OAUTH_PROVIDERS[provider].name}’s console
                </a>
              </>
            )}
            .
          </FieldDescription>
        </Field>
      )}
      {!!deviceCode && <DeviceCodePanel code={deviceCode} />}
      <DialogFooter className="items-center">
        {isBusy && method !== 'key' && !deviceCode && <span className="mr-auto type-meta text-muted-foreground">Finish signing in in your browser…</span>}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!isReady}>
          {isBusy && <Spinner data-icon="inline-start" />}
          {method === 'key' ? 'Connect' : 'Continue in browser'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function signInMethods(name: string, provider: ReturnType<typeof oauthProviderFor>, hasMochiApp: boolean) {
  const providerName = provider && OAUTH_PROVIDERS[provider].name;
  const isDevice = !!provider && OAUTH_PROVIDERS[provider].flow === 'device';
  const browserBody = !providerName
    ? `Opens ${name}’s sign-in page. Works for most services.`
    : !hasMochiApp
      ? `${providerName} doesn’t let apps register themselves, and this build has no Mochi app for it yet, so it needs your own.`
      : isDevice
        ? `Opens ${providerName} and shows a one-time code to enter there, through Mochi’s own ${providerName} app.`
        : `Opens ${providerName}’s sign-in page, through Mochi’s own ${providerName} app.`;
  return {
    oauth: { title: 'Sign in in your browser', body: browserBody, isDisabled: !!provider && !hasMochiApp },
    key: { title: 'API key or token', body: 'Sent with every call. For services that hand out keys.', isDisabled: false },
    app: { title: 'Your own OAuth app', body: 'A client ID from an app you registered with the service.', isDisabled: false },
  } satisfies Record<SignInMethod, { title: string; body: string; isDisabled: boolean }>;
}

/** The one-time code a device sign-in for `url` is waiting on; null until main sends one, or when nothing is signing in. */
function useDeviceCode(url: string | null) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  useEffect(() => {
    setCode(null);
    if (!url) return;
    return host.library.onDeviceCode((next) => next.url === url && setCode(next));
  }, [url]);
  return code;
}

function DeviceCodePanel({ code }: { code: DeviceCode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 p-4 text-center">
      <span className="type-meta text-muted-foreground">Enter this code on the page that opened ({new URL(code.verificationUri).host})</span>
      <span className="font-mono text-2xl font-semibold tracking-widest tabular">{code.userCode}</span>
      <Button type="button" variant="outline" size="sm" onClick={() => copyText(code.userCode, 'Code copied')}>
        <Copy data-icon="inline-start" />
        Copy code
      </Button>
      <span className="type-caption text-muted-foreground">Waiting for you to approve it…</span>
    </div>
  );
}

/** Which providers Mochi has its own app for; null until main answers. Read once per app run. */
function useMochiOAuthApps() {
  const [apps, setApps] = useState<OAuthProviderId[] | null>(mochiApps);
  useEffect(() => {
    if (apps) return;
    void host.library.oauthApps().then((list) => {
      mochiApps = list;
      setApps(list);
    }, () => setApps([]));
  }, [apps]);
  return apps;
}

let mochiApps: OAuthProviderId[] | null = null;

const ALIAS_SUGGESTIONS = ['personal', 'work', 'client', 'team'];

/** The first suggested name no account on the service has yet, so the dialog never opens already in an error. */
function freeAlias(taken: string[]) {
  return ALIAS_SUGGESTIONS.find((a) => !taken.includes(a)) ?? `account-${taken.length + 1}`;
}
