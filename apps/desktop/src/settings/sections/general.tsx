import { Shortcut } from '../../Shortcut';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup, SettingsRow } from '../parts';

export function GeneralSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup
        title="New threads"
        footer={
          <span className="inline-flex flex-wrap items-center gap-1">
            The composer can still change each thread. Hold{' '}
            <Shortcut keys={['mod']} /> while sending to do the other for that
            one message.
          </span>
        }
      >
        <CatalogRow settingKey="agent" />
        <CatalogRow settingKey="permissions" />
        <CatalogRow settingKey="whileWorking" />
      </SettingsGroup>
      <SettingsGroup title="Composer">
        <CatalogRow settingKey="promptSuggestions" />
      </SettingsGroup>
      <SettingsGroup title="End of turn">
        <CatalogRow settingKey="turnSpine" />
      </SettingsGroup>
      <SettingsGroup title="Running agents">
        <CatalogRow settingKey="concurrency" />
        <SettingsRow
          id="usageLimit"
          label="When a usage limit hits"
          description="Continuing on an API key or another harness is your call, per thread"
          control={
            <span className="type-body text-muted-foreground">
              Pause until reset
            </span>
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Folders">
        <CatalogRow settingKey="projectsFolder" />
      </SettingsGroup>
      <SettingsGroup title="Settled threads">
        <CatalogRow settingKey="settledCleanup" />
      </SettingsGroup>
      <SettingsGroup title="Startup">
        <CatalogRow settingKey="restoreLayout" />
      </SettingsGroup>
    </div>
  );
}
