import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { ChevronDown, Flash, Monitor, Moon, Pause, Play, Refresh, RefreshCircle, Setting2, Sun, UserCircle } from 'reicon-react';
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
import { useMochiAccount } from './account/useMochiAccount';
import { showsDemoData } from './demoData';
import { host } from './host';
import type { AppUpdate } from './host/types/updates';
import { openSettings } from './settings/open';
import { BoundShortcut } from './Shortcut';
import { useHarness } from './store';
import { IconSwap } from './ui';

/** The sidebar's bottom-left chip: your first name, opening account, settings, theme and app updates. */
export function UserMenu() {
  const { state, dispatch } = useHarness();
  const user = useMochiAccount().account?.user;
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
        <DropdownMenuItem onSelect={() => openSettings('account')}>
          <UserCircle />
          Account
        </DropdownMenuItem>
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
