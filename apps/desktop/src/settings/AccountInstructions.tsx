import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from '@/icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/toast/store';
import { plural } from '@mochi/domain/lib/format';
import { host } from '../host';
import type { Provider, Space } from '../model';
import { queryKeys } from '../queryKeys';
import { ProviderMark } from '../ui';
import { ipcMessage } from './AgentSettings';
import { INSTRUCTIONS_FILE } from './agentConfig';
import { HARNESSES, HARNESS_IDS } from './harnesses';
import { InstructionsTextEditor } from './InstructionsEditor';
import { SettingsGroup, SettingsRow } from './parts';
import { useConfigWriter, useProfileConfig } from './ProfileAgentConfig';
import { useProfileFolder } from './ProfileInstructions';

/**
 * The CLAUDE.md and AGENTS.md of the accounts this profile signs in with. The tools load them on their own, in every
 * profile that links the account; saving goes through the same diff review and backup as the other config files, and
 * the switch only decides whether this profile's new threads load the file (the file itself is never changed by it).
 */
export function AccountInstructions({ profile }: { profile: Space }) {
  const { config, error, reload } = useProfileConfig(profile.id);
  const { review, dialog } = useConfigWriter(profile.id, reload);
  const folder = useProfileFolder(profile.id);
  const switchMutation = useAccountFileSwitch(profile);
  const [editing, setEditing] = useState<Provider | null>(null);
  const save = (provider: Provider, text: string) =>
    review(`Edit ${INSTRUCTIONS_FILE[provider]}`, [
      { kind: 'instructions-set', provider, text },
    ]).then((isWritten) => isWritten && setEditing(null));

  return (
    <SettingsGroup
      id="instructionsAccount"
      title="Your CLAUDE.md and AGENTS.md"
      footer={
        error ?? (
          <>
            Claude Code and Codex load these themselves, in every profile that
            uses the account. Turning one off only keeps it out of{' '}
            {profile.name}’s new threads. Saving shows the change first and
            backs the old file up.
            {!!alwaysLoaded.length &&
              ` ${alwaysLoaded.join(' and ')} can’t leave its file out, so it always loads.`}
          </>
        )
      }
    >
      {!config && !error && (
        <SettingsRow label="Reading the accounts’ files…" />
      )}
      {!!config &&
        HARNESS_IDS.map((provider) => {
          const { instructions, account } = config[provider];
          const file = INSTRUCTIONS_FILE[provider];
          const harness = HARNESSES[provider];
          const lines = instructions.text.trim()
            ? instructions.text.trimEnd().split('\n').length
            : 0;
          const isUsed = folder?.usesAccountFile[provider] ?? true;
          return (
            <SettingsRow
              key={provider}
              label={
                <span className="flex items-center gap-2">
                  <ProviderMark provider={provider} size={14} />
                  <span className="font-mono">{file}</span>
                </span>
              }
              description={`${harness.name}, ${account.name} · ${lines ? `${lines} ${plural(lines, 'line', 'lines')}` : 'empty'} · ${accountFileStatus(harness.canSkipAccountInstructions, isUsed, profile.name)}`}
              control={
                host.isDesktop && (
                  <div className="flex items-center gap-3">
                    {harness.canSkipAccountInstructions && (
                      <Switch
                        checked={isUsed}
                        disabled={!folder || switchMutation.isPending}
                        aria-label={`Load ${file} in ${profile.name}`}
                        onCheckedChange={(next) =>
                          switchMutation.mutate({ provider, isUsed: next })
                        }
                      />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={editing === provider}
                      onClick={() => setEditing(provider)}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                  </div>
                )
              }
            >
              {editing === provider && (
                <InstructionsTextEditor
                  name={file}
                  initial={instructions.text}
                  isSaving={false}
                  saveLabel="Review changes"
                  onSave={(text) => void save(provider, text)}
                  onClose={() => setEditing(null)}
                />
              )}
            </SettingsRow>
          );
        })}
      {dialog}
    </SettingsGroup>
  );
}

// Harnesses with no way to start a thread without the account's file.
const alwaysLoaded = HARNESS_IDS.filter(
  (provider) => !HARNESSES[provider].canSkipAccountInstructions,
).map((provider) => HARNESSES[provider].name);

const accountFileStatus = (
  canSkip: boolean,
  isUsed: boolean,
  profileName: string,
) => {
  if (!canSkip) return 'always loaded';
  return isUsed ? 'loaded' : `off in ${profileName}`;
};

/** Turns the account's file on or off for the profile, with an undo toast: it changes nothing on disk but the profile's flag. */
function useAccountFileSwitch(profile: Space) {
  const queryClient = useQueryClient();
  const set = (provider: Provider, isUsed: boolean) =>
    host.settings.setAccountInstructions(profile.id, provider, isUsed);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.profile.folder(profile.id),
    });
  return useMutation({
    mutationFn: ({
      provider,
      isUsed,
    }: {
      provider: Provider;
      isUsed: boolean;
    }) => set(provider, isUsed),
    onSuccess: async (_, { provider, isUsed }) => {
      await refresh();
      const file = INSTRUCTIONS_FILE[provider];
      toast(
        isUsed
          ? `${file} loads in ${profile.name} again`
          : `${file} is off in ${profile.name}`,
        {
          description: isUsed
            ? 'New threads load it.'
            : `${HARNESSES[provider].name} still loads it elsewhere. New threads in ${profile.name} start without it.`,
          action: {
            label: 'Undo',
            onClick: () =>
              void set(provider, !isUsed).then(refresh, (error: Error) =>
                toast.error('Couldn’t undo', {
                  description: ipcMessage(error),
                }),
              ),
          },
        },
      );
    },
    onError: (error) =>
      toast.error('Couldn’t change the setting', {
        description: ipcMessage(error),
      }),
  });
}
