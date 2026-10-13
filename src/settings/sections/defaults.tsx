import { Shortcut } from '../../Shortcut';
import { CatalogRow } from '../CatalogRow';
import { DesktopOnly, SettingsGroup, SettingsRow } from '../parts';

export function DefaultsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Where a new thread starts; the composer can still change each one.">
        <CatalogRow settingKey="agent" />
        <CatalogRow settingKey="permissions" />
      </SettingsGroup>
      <SettingsGroup
        footer={
          <span className="inline-flex flex-wrap items-center gap-1">
            Hold <Shortcut keys={['mod']} /> while sending to do the other for that one message. Queued messages go out one per turn, in order.
          </span>
        }
      >
        <CatalogRow settingKey="whileWorking" />
      </SettingsGroup>
      <SettingsGroup footer="New side chats answer on this model, Claude or Codex, through this profile's account; the side chat's own model button can still change each one.">
        <CatalogRow settingKey="sideChatModel" />
      </SettingsGroup>
      <DesktopOnly what="The concurrency limit only works in the Mochi desktop app.">
        <SettingsGroup footer="A thread with its own process (Claude Code runs one per thread) waits its turn past this limit.">
          <CatalogRow settingKey="concurrency" />
        </SettingsGroup>
      </DesktopOnly>
      <SettingsGroup footer="Continuing on your API key or handing off to another harness is your call, per thread. Mochi never switches a thread to another account.">
        <SettingsRow id="usageLimit" label="When a usage limit hits" control={<span className="type-body text-muted-foreground">Pause until reset</span>} />
      </SettingsGroup>
    </div>
  );
}
