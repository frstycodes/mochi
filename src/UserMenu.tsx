import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { ChevronDown, Flash, Login, Logout, Monitor, Moon, Pause, Play, Refresh, RefreshCircle, Setting2, Sun, UserCircle, UserEdit } from 'reicon-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useMochiAccount } from './account/useMochiAccount';
import { showsDemoData } from './demoData';
import { host } from './host';
import type { MochiUser } from './host/types/account';
import type { AppUpdate } from './host/types/updates';
import { openSettings } from './settings/open';
import { BoundShortcut } from './Shortcut';
import { useHarness } from './store';
import { IconSwap } from './ui';

/** The sidebar's bottom-left chip: your first name, opening your Mochi account, settings, theme and app updates. */
export function UserMenu() {
  const { state, dispatch } = useHarness();
  const mochiAccount = useMochiAccount();
  const user = mochiAccount.account?.user;
  const name = firstName(user?.name ?? null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${name ?? 'Account'}: account, settings and theme`} className="h-7 max-w-36 min-w-0 gap-1.5 rounded-lg px-1.5 font-normal text-muted-foreground hover:text-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-foreground">
          <Avatar className="size-5">
            {!!user?.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
            <AvatarFallback className="text-[0.625rem] font-semibold">{name ? name[0].toUpperCase() : <UserCircle className="size-3.5" />}</AvatarFallback>
          </Avatar>
          <span className="truncate">{name ?? 'Account'}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <AccountItems {...mochiAccount} />
        <DropdownMenuItem onSelect={() => openSettings()}>
          <Setting2 />
          Settings
          <BoundShortcut command="go-settings" className="ml-auto" />
        </DropdownMenuItem>
        <ThemeSubmenu />
        <DropdownMenuSeparator />
        <UpdateItems />
        {showsDemoData() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Prototype</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => dispatch({ type: 'pause' })}>
                <IconSwap id={state.paused ? 'play' : 'pause'}>{state.paused ? <Play /> : <Pause />}</IconSwap>
                {state.paused ? 'Resume simulation' : 'Pause simulation'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dispatch({ type: 'trigger-overlap' })}>
                <Flash />
                Trigger an overlap
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dispatch({ type: 'reset' })}>
                <Refresh />
                Reset demo
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal text-subtle-foreground">Hold Option, or long-press, for Orbit</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Your Mochi account: sign in, or who you're signed in as with Clerk's Account Portal and Sign out. Nothing where sign-in isn't set up (web, builds without a Clerk app). */
function AccountItems({ account, signIn, cancelSignIn, signOut, openAccountPortal }: ReturnType<typeof useMochiAccount>) {
  if (!account || account.status === 'unconfigured') return null;
  return (
    <>
      {account.status === 'signed-out' && (
        <DropdownMenuItem onSelect={() => void signIn()}>
          <Login />
          Sign in
          <span className="ml-auto text-subtle-foreground">Opens browser</span>
        </DropdownMenuItem>
      )}
      {account.status === 'signing-in' && (
        <>
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <Spinner className="size-3.5" />
            Finish signing in in your browser
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void cancelSignIn()}>Cancel sign-in</DropdownMenuItem>
        </>
      )}
      {account.status === 'signed-in' && !!account.user && (
        <>
          <SignedInLabel user={account.user} isPersistent={account.isPersistent} />
          <DropdownMenuItem onSelect={() => void openAccountPortal()}>
            <UserEdit />
            Manage account
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <Logout />
            Sign out
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
    </>
  );
}

function SignedInLabel({ user, isPersistent }: { user: MochiUser; isPersistent: boolean }) {
  const shown = user.name ?? user.email ?? 'Signed in';
  return (
    <DropdownMenuLabel className="flex min-w-0 items-center gap-2 font-normal">
      <Avatar className="size-7">
        {!!user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
        <AvatarFallback className="type-caption">{shown[0].toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-foreground">{shown}</span>
        {!!user.email && user.email !== shown && <span className="truncate type-caption text-subtle-foreground">{user.email}</span>}
        {!isPersistent && <span className="type-caption text-subtle-foreground">Signed in until Mochi quits</span>}
      </span>
    </DropdownMenuLabel>
  );
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

const THEMES = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

function ThemeSubmenu() {
  const { theme = 'system', setTheme } = useTheme();
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <IconSwap id={current.value}>
          <current.Icon />
        </IconSwap>
        Theme
        <span className="ml-auto text-subtle-foreground">{current.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={current.value} onValueChange={setTheme}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The version, what the updater is doing, and the one action it allows right now. */
function UpdateItems() {
  const update = useAppUpdate();
  if (!update) return null;
  const canCheck = update.status === 'idle' || update.status === 'up-to-date' || update.status === 'error';
  return (
    <>
      <DropdownMenuLabel className="flex flex-col font-normal">
        <span className="text-foreground">Mochi {update.version}</span>
        <span className="type-caption text-subtle-foreground">{UPDATE_STATUS[update.status]}</span>
        {update.status === 'error' && !!update.error && <span className="type-caption text-destructive">{update.error}</span>}
      </DropdownMenuLabel>
      {update.status === 'ready' && (
        <DropdownMenuItem onSelect={() => void host.updates.install()}>
          <RefreshCircle />
          Restart to update
        </DropdownMenuItem>
      )}
      {canCheck && (
        // Stays open so you see the check run and land.
        <DropdownMenuItem onSelect={(e) => (e.preventDefault(), void host.updates.check())}>
          <Refresh />
          Check for updates
        </DropdownMenuItem>
      )}
    </>
  );
}

const UPDATE_STATUS = {
  unconfigured: "Updates aren't set up in this build",
  unsupported: 'Updates come with each new download',
  idle: 'Not checked yet',
  checking: 'Checking for updates…',
  'up-to-date': 'Up to date',
  downloading: 'Downloading an update…',
  ready: 'An update is ready',
  error: "Couldn't check for updates",
} satisfies Record<AppUpdate['status'], string>;

function useAppUpdate() {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  useEffect(() => {
    let isLive = true;
    void host.updates.get().then((u) => isLive && setUpdate(u));
    const off = host.updates.onChange(setUpdate);
    return () => {
      isLive = false;
      off();
    };
  }, []);
  return update;
}
