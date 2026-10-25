import { useState } from 'react';
import { Refresh, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Provider } from '../../model';
import { ProviderMark, TooltipIconButton } from '../../ui';
import { defaultAccountId } from '../accounts';
import { useAgentSettings } from '../AgentSettings';
import { CatalogRow } from '../CatalogRow';
import { AccountsGroup, ProfilesGroup } from '../HarnessAccounts';
import { useLinkedTab } from '../../routes/nav';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import {
  CommandLine,
  DesktopOnly,
  SettingsGroup,
  SettingsRow,
  settingControlId,
} from '../parts';

/** Every harness from the registry, one tab each; nothing here names a specific harness. Deep links (`claudePath`) open their harness. */
export function HarnessesSection() {
  const [shown, setShown] = useLinkedTab(
    (settingId) => HARNESS_IDS.find((id) => settingId.startsWith(id)),
    HARNESS_IDS[0],
  );
  const { isUpdateAvailable } = useAgentSettings();
  return (
    <div className="flex flex-col gap-10">
      <p className="type-meta text-muted-foreground">
        Mochi runs your own installs with the logins you set up in them. It
        never signs in for you and never sees your credentials.
      </p>
      <DesktopOnly what="Detecting your agent harnesses and their accounts, and storing an API key, only work in the Mochi desktop app.">
        <Tabs
          value={shown}
          onValueChange={(v) => setShown(v as Provider)}
          className="gap-6"
        >
          <TabsList
            variant="line"
            className="w-full justify-start overflow-x-auto"
          >
            {HARNESS_IDS.map((provider) => (
              <TabsTrigger
                key={provider}
                value={provider}
                className="flex-none px-2"
              >
                <ProviderMark provider={provider} size={14} />
                {HARNESSES[provider].name}
                {isUpdateAvailable(provider) && (
                  <span
                    className="size-1.5 rounded-full bg-warning"
                    aria-label="Update available"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={shown}>
            <HarnessSettings key={shown} provider={shown} />
          </TabsContent>
        </Tabs>
      </DesktopOnly>
    </div>
  );
}

function HarnessSettings({ provider }: { provider: Provider }) {
  const {
    installs,
    checkProvider,
    settings,
    latest,
    updating,
    restartNeeded,
    updateHarness,
    isUpdateAvailable,
  } = useAgentSettings();
  const harness = HARNESSES[provider];
  const install = installs[defaultAccountId(provider)];
  const detected = install === 'checking' ? undefined : install;
  const isMissing = !!detected && !detected.path;
  const needsRepair = !!detected?.path && !detected.version;

  return (
    <section
      aria-labelledby={`harness-${provider}`}
      className="flex flex-col gap-5"
    >
      <header
        data-setting-id={`${provider}Install`}
        className="flex items-center gap-3"
      >
        <ProviderMark provider={provider} size={32} />
        <div className="min-w-0 flex-1">
          <h2 id={`harness-${provider}`} className="type-title">
            {harness.name}
            {!!detected?.version && (
              <span className="ml-1.5 font-normal text-muted-foreground tabular">
                {detected.version}
              </span>
            )}
          </h2>
          <p className="truncate font-mono type-caption text-muted-foreground">
            {detected?.path ??
              (isMissing ? 'Not installed' : 'Looking for it…')}
          </p>
        </div>
        <TooltipIconButton
          label="Check again"
          hint={`Asks ${harness.name} for its version and every account's login`}
          onClick={() => checkProvider(provider)}
          disabled={install === 'checking'}
        >
          <Refresh />
        </TooltipIconButton>
      </header>
      {isMissing ? (
        <SettingsGroup
          title="Not installed"
          footer="Installed somewhere unusual? Set its path here instead."
        >
          <SettingsRow
            label={`Install ${harness.name}`}
            description={
              <a
                href={harness.docs}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Setup guide
              </a>
            }
          >
            <CommandLine command={harness.install} />
          </SettingsRow>
          {!!settings && <CatalogRow settingKey={`${provider}.path`} />}
        </SettingsGroup>
      ) : (
        !!settings && (
          <SettingsGroup title="Install">
            {needsRepair ? (
              <SettingsRow
                label="Install needs repair"
                description={
                  detected.login.state === 'unknown'
                    ? detected.login.reason
                    : 'The executable did not report a version.'
                }
              >
                <CommandLine
                  command={
                    provider === 'codex'
                      ? 'npm install -g @openai/codex@latest --include=optional'
                      : harness.install
                  }
                />
              </SettingsRow>
            ) : (
              <SettingsRow
                id={`${provider}Update`}
                label={
                  <span className="flex items-center gap-2">
                    Version{' '}
                    {isUpdateAvailable(provider) && (
                      <Badge variant="outline" className="text-warning">
                        Update available
                      </Badge>
                    )}
                  </span>
                }
                description={
                  restartNeeded.includes(provider)
                    ? `Installed ${detected?.version ?? 'new version'}. Restart Mochi to use it in existing sessions.`
                    : latest[provider] === undefined
                      ? 'Checking for updates…'
                      : latest[provider]
                        ? `Installed ${detected?.version ?? 'unknown'} · latest ${latest[provider]}`
                        : 'Could not check the latest version'
                }
                control={
                  isUpdateAvailable(provider) ? (
                    <Button
                      id={settingControlId(`${provider}Update`)}
                      variant="outline"
                      size="sm"
                      disabled={!!updating}
                      onClick={() => updateHarness(provider)}
                    >
                      {updating === provider
                        ? 'Updating…'
                        : `Update ${harness.name}`}
                    </Button>
                  ) : (
                    <span
                      id={settingControlId(`${provider}Update`)}
                      className="type-meta text-muted-foreground"
                    >
                      {latest[provider] === undefined
                        ? 'Checking'
                        : latest[provider]
                          ? 'Up to date'
                          : 'Unavailable'}
                    </span>
                  )
                }
              />
            )}
            <CatalogRow settingKey={`${provider}.path`} />
          </SettingsGroup>
        )
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
          Optional, for using {harness.name} without signing in. Mochi passes it
          as <code className="font-mono">{env}</code>, which bills your API
          account instead of any subscription, in every profile. Kept in your OS
          keychain and never shown here again.
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
            <Button
              id={settingControlId(id)}
              variant="outline"
              size="sm"
              onClick={() => void saveApiKey(provider, null)}
            >
              <Trash data-icon="inline-start" />
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
                void saveApiKey(provider, draft).then(
                  (isSaved) => isSaved && setDraft(''),
                );
              }}
            >
              <Input
                id={settingControlId(id)}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  apiKey?.canStore === false
                    ? 'Needs the OS keychain'
                    : placeholder
                }
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
