import { useState } from 'react';
import { Refresh, Trash3 } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { EFFORTS, MODELS, toggleStar } from '../../ModelControls';
import type { Provider } from '../../model';
import { ProviderMark, TooltipIconButton } from '../../ui';
import { defaultAccountId } from '../accounts';
import { useAgentSettings } from '../AgentSettings';
import { AccountsGroup, ProfilesGroup } from '../HarnessAccounts';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { CommandLine, CommitInput, DesktopOnly, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs, type Prefs } from '../prefs';

/** Every harness from the registry, one after another; nothing here names a specific harness. */
export function HarnessesSection() {
  return (
    <div className="flex flex-col gap-10">
      <p className="type-meta text-muted-foreground">Mochi runs your own installs with the logins you set up in them. It never signs in for you and never sees your credentials.</p>
      <DesktopOnly what="Detecting your agent harnesses and their accounts, and storing an API key, only work in the Mochi desktop app.">
        {HARNESS_IDS.map((provider) => (
          <HarnessSettings key={provider} provider={provider} />
        ))}
      </DesktopOnly>
      <ModelsGroup />
    </div>
  );
}

/** Across harnesses: the model chip's scroll dock shows starred models, and new threads start at this effort. */
function ModelsGroup() {
  const { starredModels, effort } = usePrefs();
  return (
    <SettingsGroup id="starredModels" title="Models" footer="Starred models show up when you scroll over the model button in the composer.">
      {MODELS.map((m) => (
        <SettingsRow
          key={m.id}
          id={`starred-${m.id}`}
          label={
            <span className="flex items-center gap-2">
              <ProviderMark provider={m.harness} size={14} />
              {m.name}
            </span>
          }
          description={m.note}
          control={
            <Switch
              id={settingControlId(`starred-${m.id}`)}
              aria-label={`Star ${m.name}`}
              checked={starredModels.includes(m.id)}
              onCheckedChange={() => setPrefs({ starredModels: toggleStar(starredModels, m.id) })}
            />
          }
        />
      ))}
      <SettingsRow
        id="effort"
        label="Default effort"
        control={
          <NativeSelect id={settingControlId('effort')} value={effort} onChange={(e) => setPrefs({ effort: e.target.value as Prefs['effort'] })}>
            {EFFORTS.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {level}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      />
    </SettingsGroup>
  );
}

function HarnessSettings({ provider }: { provider: Provider }) {
  const { installs, checkProvider, settings, update } = useAgentSettings();
  const harness = HARNESSES[provider];
  const install = installs[defaultAccountId(provider)];
  const detected = install === 'checking' ? undefined : install;
  const isMissing = !!detected && !detected.path;

  return (
    <section aria-labelledby={`harness-${provider}`} className="flex flex-col gap-5">
      <header data-setting-id={`${provider}Install`} className="flex items-center gap-3">
        <ProviderMark provider={provider} size={32} />
        <div className="min-w-0 flex-1">
          <h2 id={`harness-${provider}`} className="type-title">
            {harness.name}
            {!!detected?.version && <span className="ml-1.5 font-normal text-muted-foreground tabular">{detected.version}</span>}
          </h2>
          <p className="truncate font-mono type-caption text-muted-foreground">{detected?.path ?? (isMissing ? 'Not installed' : 'Looking for it…')}</p>
        </div>
        <TooltipIconButton label="Check again" hint={`Asks ${harness.name} for its version and every account's login`} onClick={() => checkProvider(provider)} disabled={install === 'checking'}>
          <Refresh />
        </TooltipIconButton>
      </header>
      {isMissing && (
        <SettingsGroup footer={`If it's installed somewhere unusual, set its path below.`}>
          <SettingsRow label={`Install ${harness.name}`} description={<a href={harness.docs} target="_blank" rel="noreferrer" className="underline underline-offset-4">Setup guide</a>}>
            <CommandLine command={harness.install} />
          </SettingsRow>
        </SettingsGroup>
      )}
      {!!settings && (
        <SettingsGroup>
          <SettingsRow
            id={`${provider}Path`}
            label="Custom path"
            description="Leave empty to use the one on your PATH."
            control={
              <CommitInput
                id={settingControlId(`${provider}Path`)}
                value={settings.harnesses[provider].path}
                placeholder="Found on your PATH"
                onCommit={(path) => void update({ harnesses: { [provider]: { path } } })}
                className="font-mono placeholder:font-sans"
              />
            }
          />
          <SettingsRow
            id={`${provider}Model`}
            label="Default model"
            description="New threads start on this model."
            control={
              <CommitInput id={settingControlId(`${provider}Model`)} value={settings.harnesses[provider].model} placeholder={harness.modelHint} onCommit={(model) => void update({ harnesses: { [provider]: { model } } })} />
            }
          />
        </SettingsGroup>
      )}
      {!isMissing && <AccountsGroup provider={provider} />}
      <ProfilesGroup provider={provider} />
      {!!harness.apiKey && <ApiKeyGroup provider={provider} />}
    </section>
  );
}

function ApiKeyGroup({ provider }: { provider: Provider }) {
  const { apiKeys, saveApiKey } = useAgentSettings();
  const [draft, setDraft] = useState('');
  const harness = HARNESSES[provider];
  const apiKey = apiKeys[provider];
  const { label, env, placeholder } = harness.apiKey!;
  const id = `${provider}ApiKey`;
  return (
    <SettingsGroup
      footer={
        <>
          Optional, for using {harness.name} without signing in. Mochi passes it as <code className="font-mono">{env}</code>, which bills your API account instead of any subscription, in every
          profile. Kept in your OS keychain and never shown here again.
        </>
      }
    >
      {apiKey?.isSet ? (
        <SettingsRow
          id={id}
          label={label}
          description={
            <>
              Set, ending in <span className="font-mono">{apiKey.last4}</span>
            </>
          }
          control={
            <Button id={settingControlId(id)} variant="outline" size="sm" onClick={() => void saveApiKey(provider, null)}>
              <Trash3 data-icon="inline-start" />
              Remove key
            </Button>
          }
        />
      ) : (
        <SettingsRow
          id={id}
          label={label}
          control={
            <form
              className="flex w-full items-center gap-2 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                void saveApiKey(provider, draft).then((isSaved) => isSaved && setDraft(''));
              }}
            >
              <Input
                id={settingControlId(id)}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={apiKey?.canStore === false ? 'Needs the OS keychain' : placeholder}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={apiKey?.canStore === false}
                className="font-mono sm:w-52"
              />
              <Button type="submit" variant="outline" disabled={!draft.trim()}>
                Save
              </Button>
            </form>
          }
        />
      )}
    </SettingsGroup>
  );
}
