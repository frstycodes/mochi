import { useTheme } from 'next-themes';
import {
  ChevronDown,
  Login,
  Logout,
  Monitor,
  Moon,
  Pause,
  Play,
  Refresh,
  Rotation,
  Settings,
  Chart,
  Sun,
  UserCircle,
  RaisedHand,
} from '@/icons';
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
import { host } from './host';
import { useUpdates } from './updates/useUpdates';
import { showsDemoData } from './demoData';
import type { MochiUser } from '@mochi/domain/host/types/account';
import { openSettings } from './routes/nav';
import { BoundShortcut } from './Shortcut';
import { useDispatch, useHarnessSelector } from './store';
import { IconSwap } from './ui';

/** The sidebar's bottom-left chip: your first name, opening your Mochi account, settings and theme. */
export function UserMenu() {
  const dispatch = useDispatch();
  const isPaused = useHarnessSelector((s) => s.paused);
  const mochiAccount = useMochiAccount();
  const user = mochiAccount.account?.user;
  const name = firstName(user?.name ?? null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${name ?? 'Account'}: account, settings and theme`}
          className="h-7 max-w-36 min-w-0 gap-1.5 rounded-lg px-1.5 font-normal text-muted-foreground hover:text-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-foreground"
        >
          <Avatar className="size-5">
            {!!user?.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
            <AvatarFallback className="text-[0.625rem] font-semibold">
              {name ? (
                name[0].toUpperCase()
              ) : (
                <UserCircle className="size-3.5" />
              )}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{name ?? 'Account'}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <AccountItems {...mochiAccount} />
        <DropdownMenuItem
          onSelect={() => dispatch({ type: 'go', view: { kind: 'usage' } })}
        >
          <Chart />
          Usage
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSettings()}>
          <Settings />
          Settings
          <BoundShortcut command="go-settings" className="ml-auto" />
        </DropdownMenuItem>
        <ThemeSubmenu />
        {host.isDesktop && <UpdateItems />}
        {showsDemoData() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Prototype</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => dispatch({ type: 'pause' })}>
                <IconSwap id={isPaused ? 'play' : 'pause'}>
                  {isPaused ? <Play /> : <Pause />}
                </IconSwap>
                {isPaused ? 'Resume simulation' : 'Pause simulation'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dispatch({ type: 'reset' })}>
                <Refresh />
                Reset demo
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal text-subtle-foreground">
          Hold Option, or long-press, for Orbit
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The running version with the updater's state, and its one next step. */
function UpdateItems() {
  const { state, summary, action } = useUpdates();
  if (!state) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
        <span className="tabular">Mochi {state.version}</span>
        <span className="text-subtle-foreground">{summary}</span>
      </DropdownMenuLabel>
      {!!action && (
        <DropdownMenuItem onSelect={() => void action.run()}>
          {action.kind === 'install' ? <Rotation /> : <Refresh />}
          {action.label}
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Your Mochi account: sign in, or who you're signed in as with Clerk's Account Portal and Sign out. Nothing where sign-in isn't set up (web, builds without a Clerk app). */
function AccountItems({
  account,
  signIn,
  cancelSignIn,
  signOut,
  openAccountPortal,
}: ReturnType<typeof useMochiAccount>) {
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
          <DropdownMenuItem onSelect={() => void cancelSignIn()}>
            Cancel sign-in
          </DropdownMenuItem>
        </>
      )}
      {account.status === 'signed-in' && !!account.user && (
        <>
          <SignedInLabel
            user={account.user}
            isPersistent={account.isPersistent}
          />
          <DropdownMenuItem onSelect={() => void openAccountPortal()}>
            <RaisedHand />
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

function SignedInLabel({
  user,
  isPersistent,
}: {
  user: MochiUser;
  isPersistent: boolean;
}) {
  const shown = user.name ?? user.email ?? 'Signed in';
  return (
    <DropdownMenuLabel className="flex min-w-0 items-center gap-2 font-normal">
      <Avatar className="size-7">
        {!!user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
        <AvatarFallback className="type-caption">
          {shown[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-foreground">{shown}</span>
        {!!user.email && user.email !== shown && (
          <span className="truncate type-caption text-subtle-foreground">
            {user.email}
          </span>
        )}
        {!isPersistent && (
          <span className="type-caption text-subtle-foreground">
            Signed in until Mochi quits
          </span>
        )}
      </span>
    </DropdownMenuLabel>
  );
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

export const THEMES = [
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
            <DropdownMenuRadioItem
              key={value}
              value={value}
              onSelect={(e) => e.preventDefault()}
            >
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
