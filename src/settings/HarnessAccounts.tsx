import { useState } from 'react';
import { Plus, Edit, Refresh, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { Account } from '../host/types/settings';
import type { Provider } from '../model';
import { useProfiles } from '../profiles';
import { OverflowIcon, SpaceIcon, TooltipIconButton } from '../ui';
import { linkedAccountId, profilesUsing, signInCommand } from './accounts';
import { useAgentSettings } from './AgentSettings';
import { HARNESSES } from './harnesses';
import {
  CommitInput,
  LoginBadge,
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
  SignInSteps,
} from './parts';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/** A harness's logins, each in its own config folder, plus adding one. */
export function AccountsGroup({ provider }: { provider: Provider }) {
  const { accounts } = useAgentSettings();
  const own = accounts?.accounts.filter((a) => a.provider === provider) ?? [];
  return (
    <SettingsGroup
      id={`${provider}Accounts`}
      title="Accounts"
      footer={`Each account is its own ${HARNESSES[provider].name} login in its own folder. You sign in from a terminal; Mochi never sees the credentials.`}
    >
      {own.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
      <AddAccountRow provider={provider} />
    </SettingsGroup>
  );
}

function AccountRow({ account }: { account: Account }) {
  const { installs, check, accounts, renameAccount, removeAccount } =
    useAgentSettings();
  const [isRenaming, setRenaming] = useState(false);
  const install = installs[account.id];
  const profiles = useProfiles();
  const usedBy = profilesUsing(
    accounts?.links ?? {},
    profiles.map((p) => p.id),
    account,
  ).map((id) => profiles.find((p) => p.id === id)!.name);
  const removeBlock = !account.configDir
    ? 'The default account stays'
    : usedBy.length
      ? `Used by ${LIST.format(usedBy)}; switch ${usedBy.length > 1 ? 'them' : 'it'} to another account first`
      : undefined;

  return (
    <SettingsRow
      label={
        isRenaming ? (
          <CommitInput
            aria-label="Account name"
            autoFocus
            value={account.name}
            onCommit={(name) => void (name && renameAccount(account.id, name))}
            onBlurCapture={() => setRenaming(false)}
            className="h-7 sm:w-48"
          />
        ) : (
          account.name
        )
      }
      description={
        <>
          <span className="block truncate font-mono">
            {account.configDir ?? HARNESSES[account.provider].defaultFolder}
          </span>
          {usedBy.length
            ? `Used by ${LIST.format(usedBy)}`
            : 'No profile uses it yet'}
        </>
      }
      control={
        <div className="flex items-center gap-1">
          <LoginBadge install={install} />
          <TooltipIconButton
            label="Check again"
            hint="Asks the harness what this account is signed in with"
            onClick={() => check(account.id)}
            disabled={install === 'checking'}
          >
            <Refresh />
          </TooltipIconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${account.name} actions`}
              >
                <OverflowIcon vertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Edit />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!!removeBlock}
                onSelect={() => void removeAccount(account.id)}
                className="flex-wrap"
              >
                <Trash />
                Remove
                <span className="w-full pl-6 type-caption text-muted-foreground">
                  {removeBlock ?? 'Its folder and the login in it stay on disk'}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <SignInSteps
        install={install}
        command={signInCommand(account)}
        onCheck={() => check(account.id)}
      />
    </SettingsRow>
  );
}

function AddAccountRow({ provider }: { provider: Provider }) {
  const { addAccount } = useAgentSettings();
  const [name, setName] = useState<string | null>(null);
  if (name === null)
    return (
      <SettingsRow
        label={
          <button
            type="button"
            onClick={() => setName('')}
            className="flex items-center gap-1.5 text-foreground hover:underline hover:underline-offset-4"
          >
            <Plus aria-hidden className="size-4" />
            Add account…
          </button>
        }
      />
    );
  return (
    <SettingsRow
      label="New account"
      control={
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void addAccount(provider, name).then(
              (isAdded) => isAdded && setName(null),
            );
          }}
        >
          <Input
            autoFocus
            aria-label="Account name"
            placeholder="Name, like Work"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sm:w-44"
          />
          <Button type="submit" variant="outline" disabled={!name.trim()}>
            Add
          </Button>
          <Button type="button" variant="ghost" onClick={() => setName(null)}>
            Cancel
          </Button>
        </form>
      }
    />
  );
}

/** Which account each profile runs this harness on: one per profile, shared across profiles as needed. */
export function ProfilesGroup({ provider }: { provider: Provider }) {
  const { accounts, linkAccount } = useAgentSettings();
  const own = accounts?.accounts.filter((a) => a.provider === provider) ?? [];
  const profiles = useProfiles();
  return (
    <SettingsGroup
      id={`${provider}Profiles`}
      title="Profiles"
      footer={`Every thread in a profile runs ${HARNESSES[provider].name} on that profile's account, and never switches to another one.`}
    >
      {profiles.map((space) => {
        const id = `${provider}-${space.id}`;
        return (
          <SettingsRow
            key={space.id}
            id={id}
            label={
              <span className="flex items-center gap-2">
                <SpaceIcon
                  space={space}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                {space.name}
              </span>
            }
            control={
              <SettingsSelect
                id={id}
                value={linkedAccountId(
                  accounts?.links ?? {},
                  space.id,
                  provider,
                )}
                options={own.map((a) => ({ value: a.id, label: a.name }))}
                onChange={(accountId) =>
                  void linkAccount(space.id, provider, accountId)
                }
              />
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
