import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ChevronDown, Copy, Key, Sparkles, type IconComponent } from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/toast/store';
import { host } from '../host';
import { copyText } from '../clipboard';
import {
  appInfo,
  appProviderFor,
  connectorFor,
  connectorIcon,
  freeAlias,
  isSameServer,
  OAUTH_PROVIDERS,
  type AppProviderId,
  type DeviceCode,
} from './connectors';
import { LibraryIcon } from './LibraryParts';
import { serviceName } from './names';
import type { Library } from './useLibrary';
import { goHome } from '../routes/nav';
import { getPrefs } from '../settings/prefs';
import { useDispatch } from '../store';
import { queryKeys } from '../queryKeys';

/**
 * Adds an account on a remote MCP server: what to call it, then how it signs in. Without a `url` it's a custom server and
 * asks for the URL first. Stays open, waiting, while a browser sign-in runs.
 */
export function ConnectAccountDialog({
  open,
  onOpenChange,
  url,
  library,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url?: string;
  library: Library;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <ConnectAccountForm
          fixedUrl={url}
          library={library}
          onCancel={() => onOpenChange(false)}
          onConnected={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type SignInMethod = 'oauth' | 'key' | 'app';

// Lives inside the dialog's content, which unmounts when it closes, so every opening starts fresh.
function ConnectAccountForm({
  fixedUrl,
  library,
  onCancel,
  onConnected,
}: {
  fixedUrl?: string;
  library: Library;
  onCancel: () => void;
  onConnected: () => void;
}) {
  const [typedUrl, setTypedUrl] = useState('');
  const url = fixedUrl ?? typedUrl.trim();
  const isUrlValid = URL.canParse(url) && /^https?:\/\//.test(url);
  const existing = library.entries?.find(
    (e) =>
      e.kind === 'connector' &&
      !!e.source &&
      isUrlValid &&
      isSameServer(e.source, url),
  );
  const [typedName, setTypedName] = useState('');
  // A server already in the library keeps its name; a new custom one may be named here, else takes the server's own.
  const isNameAsked = !fixedUrl && !existing && !connectorFor(url);
  const name = existing
    ? serviceName(existing)
    : connectorFor(url)?.name ||
      (isNameAsked && typedName.trim()) ||
      (isUrlValid ? new URL(url).hostname : 'a server');
  const provider = appProviderFor(url);
  const mochiApps = useMochiOAuthApps();
  const hasMochiApp = !!provider && !!mochiApps?.includes(provider);
  const takenAliases = (library.entries ?? []).flatMap((e) =>
    e.kind === 'connector' &&
    e.alias &&
    !!e.source &&
    isUrlValid &&
    isSameServer(e.source, url)
      ? [e.alias]
      : [],
  );
  const [alias, setAlias] = useState(() => freeAlias(takenAliases));
  const [chosenMethod, setMethod] = useState<SignInMethod>('oauth');
  // Without Mochi's own app, a provider that can't register one can't sign in in the browser: its own app is the default.
  const method =
    provider && !hasMochiApp && chosenMethod === 'oauth' ? 'app' : chosenMethod;
  const [secret, setSecret] = useState({
    apiKey: '',
    clientId: '',
    clientSecret: '',
  });
  const [isBusy, setBusy] = useState(false);
  const isTaken = takenAliases.includes(alias);
  // GitHub's device flow needs no secret; the other providers' apps are confidential clients.
  const needsSecret = !!provider && provider !== 'github';
  // A service with a known setup (Slack, Google) can have an agent make the user's own app; credentials only when they do it themselves.
  const hasAgentSetup = AGENT_SETUPS.includes(connectorFor(url)?.id ?? '');
  const [setup, setSetup] = useState<Setup>('agent');
  const byAgent = method === 'app' && hasAgentSetup && setup === 'agent';
  const isReady =
    isUrlValid &&
    !!alias &&
    !isTaken &&
    !isBusy &&
    (method !== 'key' || !!secret.apiKey) &&
    (method !== 'app' ||
      byAgent ||
      (!!secret.clientId && (!needsSecret || !!secret.clientSecret)));
  const dispatch = useDispatch();
  const startAgentSetup = () => {
    const prompt = `Connect my ${name} account named "${alias}" to Mochi, setting up my own ${name} app for it.`;
    dispatch({
      type: 'create',
      title: prompt,
      provider: getPrefs().agent,
      project: null,
      isLive: host.isDesktop,
    });
    onConnected();
    // The new thread opens behind Settings; leave it so the setup shows.
    goHome();
  };
  const deviceCode = useDeviceCode(isBusy ? url : null);
  const submit = () => {
    setBusy(true);
    const account = {
      url,
      alias,
      ...(isNameAsked && !!typedName.trim() && { name: typedName.trim() }),
      ...(method === 'key' && { apiKey: secret.apiKey }),
      ...(method === 'app' && {
        clientId: secret.clientId,
        clientSecret: secret.clientSecret,
      }),
    };
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
        if (isReady) (byAgent ? startAgentSetup : submit)();
      }}
    >
      <DialogHeader className="flex-row items-center gap-3">
        <LibraryIcon
          key={url}
          url={isUrlValid ? connectorIcon(url) : null}
          letter={fixedUrl ? name : '+'}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle>
            {fixedUrl ? `Connect ${name}` : 'Add a custom server'}
          </DialogTitle>
          <DialogDescription>
            {fixedUrl
              ? 'Its sign-in stays in this computer’s keychain.'
              : 'Any remote MCP server, by its URL. Its sign-in stays in this computer’s keychain.'}
          </DialogDescription>
        </span>
      </DialogHeader>
      {!fixedUrl && (
        <Field data-invalid={(!!typedUrl.trim() && !isUrlValid) || undefined}>
          <FieldLabel htmlFor="connect-url">Server URL</FieldLabel>
          <Input
            id="connect-url"
            autoFocus
            type="url"
            placeholder="https://mcp.example.com/mcp"
            value={typedUrl}
            onChange={(e) => setTypedUrl(e.target.value)}
            aria-invalid={!!typedUrl.trim() && !isUrlValid}
          />
          {!!typedUrl.trim() && !isUrlValid && (
            <FieldError>
              Use the full address, starting with https://
            </FieldError>
          )}
        </Field>
      )}
      {isNameAsked && (
        <Field>
          <FieldLabel htmlFor="connect-name">Connector name</FieldLabel>
          <Input
            id="connect-name"
            maxLength={64}
            placeholder={isUrlValid ? new URL(url).hostname : 'Acme'}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
          />
          <FieldDescription>
            Left empty, it takes the name the server gives itself. You can
            rename it later.
          </FieldDescription>
        </Field>
      )}
      <Field data-invalid={isTaken || undefined}>
        <FieldLabel htmlFor="connect-alias">Account name</FieldLabel>
        <Input
          id="connect-alias"
          autoFocus={!!fixedUrl}
          value={alias}
          onChange={(e) =>
            setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
          }
          aria-invalid={isTaken}
        />
        {isTaken ? (
          <FieldError>
            There is already a {alias} account on {name}.
          </FieldError>
        ) : (
          <FieldDescription>
            Short, like work or personal. Agents pick the account by this name.
          </FieldDescription>
        )}
      </Field>
      <RadioGroup
        value={method}
        onValueChange={(v) => setMethod(v as SignInMethod)}
        aria-label="How it signs in"
        className="gap-2"
      >
        {(Object.keys(methods) as SignInMethod[]).map((m) => (
          <label
            key={m}
            htmlFor={`connect-${m}`}
            className="flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/40 has-data-checked:border-foreground/25 has-data-checked:bg-accent/50 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-transparent"
          >
            <RadioGroupItem
              id={`connect-${m}`}
              value={m}
              disabled={methods[m].isDisabled}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="type-body font-medium">{methods[m].title}</span>
              <span className="type-meta text-pretty text-muted-foreground">
                {methods[m].body}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {method === 'key' && (
        <Field>
          <FieldLabel htmlFor="connect-key">API key or token</FieldLabel>
          <Input
            id="connect-key"
            type="password"
            autoComplete="off"
            value={secret.apiKey}
            onChange={(e) => setSecret({ ...secret, apiKey: e.target.value })}
          />
        </Field>
      )}
      {method === 'app' && !byAgent && (
        <Field>
          <FieldLabel htmlFor="connect-client">OAuth app</FieldLabel>
          <Input
            id="connect-client"
            placeholder="Client ID"
            value={secret.clientId}
            onChange={(e) => setSecret({ ...secret, clientId: e.target.value })}
          />
          <Input
            type="password"
            autoComplete="off"
            aria-label="Client secret"
            placeholder={
              needsSecret ? 'Client secret' : 'Client secret, if it has one'
            }
            value={secret.clientSecret}
            onChange={(e) =>
              setSecret({ ...secret, clientSecret: e.target.value })
            }
          />
          <FieldDescription>
            <OwnAppHint provider={provider} />
          </FieldDescription>
          <FieldDescription>
            Only Mochi sees the secret: it goes to this computer’s keychain,
            never to an agent.
          </FieldDescription>
        </Field>
      )}
      {!!deviceCode && <DeviceCodePanel code={deviceCode} />}
      <DialogFooter className="items-center">
        {isBusy && method !== 'key' && !deviceCode && (
          <span className="mr-auto type-meta text-muted-foreground">
            Finish signing in in your browser…
          </span>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {method === 'app' && hasAgentSetup ? (
          <SetupButton
            name={name}
            setup={setup}
            onSetup={setSetup}
            isReady={isReady}
            isBusy={isBusy}
          />
        ) : (
          <Button type="submit" disabled={!isReady}>
            {isBusy && <Spinner data-icon="inline-start" />}
            {method === 'key' ? 'Connect' : 'Continue in browser'}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

// The connectors with setup steps an agent can follow (`src/library/ownApps.ts`).
const AGENT_SETUPS: string[] = ['slack', 'google-workspace'];

type Setup = 'agent' | 'manual';

// The agent's sparkles twinkle on hover: a small turn and lift, settling back; still for reduced motion.
const TWINKLE =
  '[&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:hover:[&_svg]:scale-115 motion-safe:hover:[&_svg]:-rotate-12';

function ChoiceIcon({ icon: Icon }: { icon: IconComponent }) {
  return (
    <Icon
      aria-hidden
      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
    />
  );
}

const SETUP_CHOICES = {
  agent: {
    icon: Sparkles,
    action: 'Set up with an agent',
    title: 'Set up with an agent',
    body: (name: string) =>
      `A new thread makes your ${name} app in its browser and signs you in, asking you only what it can't decide.`,
  },
  manual: {
    icon: Key,
    action: 'Continue in browser',
    title: 'Enter credentials myself',
    body: (name: string) =>
      `Paste the client ID and secret of a ${name} app you made.`,
  },
} satisfies Record<
  Setup,
  {
    icon: IconComponent;
    action: string;
    title: string;
    body: (name: string) => string;
  }
>;

/** GitHub's merge button: the chosen way to set the app up, and a chevron to switch; switching to manual shows the fields. */
function SetupButton({
  name,
  setup,
  onSetup,
  isReady,
  isBusy,
}: {
  name: string;
  setup: Setup;
  onSetup: (setup: Setup) => void;
  isReady: boolean;
  isBusy: boolean;
}) {
  const Icon = SETUP_CHOICES[setup].icon;
  return (
    <ButtonGroup>
      <Button
        type="submit"
        disabled={!isReady}
        className={cn(setup === 'agent' && TWINKLE)}
      >
        {isBusy ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Icon data-icon="inline-start" />
        )}
        {SETUP_CHOICES[setup].action}
      </Button>
      <ButtonGroupSeparator />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            aria-label="Choose how to set up the app"
            disabled={isBusy}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup
            value={setup}
            onValueChange={(v) => onSetup(v as Setup)}
          >
            {(Object.keys(SETUP_CHOICES) as Setup[]).map((choice) => (
              <DropdownMenuRadioItem
                key={choice}
                value={choice}
                className={cn('items-start', choice === 'agent' && TWINKLE)}
              >
                <ChoiceIcon icon={SETUP_CHOICES[choice].icon} />
                <span className="flex flex-col gap-0.5">
                  <span className="type-body font-medium">
                    {SETUP_CHOICES[choice].title}
                  </span>
                  <span className="type-meta text-pretty text-muted-foreground">
                    {SETUP_CHOICES[choice].body(name)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

function signInMethods(
  name: string,
  provider: AppProviderId | undefined,
  hasMochiApp: boolean,
) {
  const providerName = provider && appInfo(provider).name;
  const isDevice =
    !!provider &&
    provider !== 'google' &&
    OAUTH_PROVIDERS[provider].flow === 'device';
  const browserBody = !providerName
    ? `Opens ${name}’s sign-in page. Works for most services.`
    : !hasMochiApp
      ? `This build of Mochi has no ${providerName} app, so it signs in through one of your own. An agent can set it up with you.`
      : isDevice
        ? `Opens ${providerName} and shows a one-time code to enter there, through Mochi’s own ${providerName} app.`
        : `Opens ${providerName}’s sign-in page, through Mochi’s own ${providerName} app.`;
  return {
    oauth: {
      title: 'Sign in in your browser',
      body: browserBody,
      isDisabled: !!provider && !hasMochiApp,
    },
    key: {
      title: 'API key or token',
      body: 'Sent with every call. For services that hand out keys.',
      isDisabled: false,
    },
    app: {
      title: 'Your own OAuth app',
      body: 'A client ID from an app you registered with the service.',
      isDisabled: false,
    },
  } satisfies Record<
    SignInMethod,
    { title: string; body: string; isDisabled: boolean }
  >;
}

/** Where the user's own app comes from and what to register in it: Google's is a Desktop client, Slack's redirects through Mochi's relay. */
function OwnAppHint({ provider }: { provider: AppProviderId | undefined }) {
  const redirect = useOwnAppRedirect();
  const consoleLink = !!provider && (
    <a href={appInfo(provider).consoleUrl} target="_blank" rel="noreferrer">
      {appInfo(provider).name}’s console
    </a>
  );
  if (provider === 'google')
    return (
      <>
        A Desktop app client from your Google Cloud project, in {consoleLink}.
        One client serves every Google account.
      </>
    );
  if (
    provider &&
    provider !== 'github' &&
    OAUTH_PROVIDERS[provider].redirect === 'relay'
  )
    return (
      <>
        Add the redirect URL{' '}
        <code className="break-all">{redirect ?? '…'}</code> to the app, in{' '}
        {consoleLink}.
      </>
    );
  return (
    <>
      A desktop client that allows a loopback redirect (http://127.0.0.1, any
      port){consoleLink && <>, from {consoleLink}</>}.
    </>
  );
}

function useOwnAppRedirect() {
  const redirectQuery = useQuery({
    queryKey: queryKeys.library.ownAppRedirect(),
    queryFn: () => host.library.ownAppRedirect(),
  });
  return redirectQuery.data ?? null;
}

/** The one-time code a device sign-in for `url` is waiting on; null until main sends one, or when nothing is signing in. */
function useDeviceCode(url: string | null) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [codeUrl, setCodeUrl] = useState(url);
  if (url !== codeUrl) {
    setCodeUrl(url);
    setCode(null);
  }
  useEffect(() => {
    if (!url) return;
    return host.library.onDeviceCode(
      (next) => next.url === url && setCode(next),
    );
  }, [url]);
  return code;
}

function DeviceCodePanel({ code }: { code: DeviceCode }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 p-4 text-center"
    >
      <span className="type-meta text-muted-foreground">
        Enter this code on the page that opened (
        {new URL(code.verificationUri).host})
      </span>
      <span className="font-mono text-2xl font-semibold tracking-widest tabular">
        {code.userCode}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => copyText(code.userCode, 'Code copied')}
      >
        <Copy data-icon="inline-start" />
        Copy code
      </Button>
      <span className="type-caption text-muted-foreground">
        Waiting for you to approve it…
      </span>
    </div>
  );
}

/** Which providers accounts can sign in with without bringing an app; null until main answers. Read per dialog: saving a Google client changes it. */
function useMochiOAuthApps() {
  const appsQuery = useQuery({
    queryKey: queryKeys.library.oauthApps(),
    queryFn: () => host.library.oauthApps(),
    staleTime: 0,
  });
  return appsQuery.data ?? (appsQuery.isError ? [] : null);
}
