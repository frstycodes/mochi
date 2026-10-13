import { useTheme } from 'next-themes';
import { TickCircle } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ModelPicker, useUnavailableHarnesses } from '../ModelControls';
import { host } from '../host';
import { authorName, type Author, type Provider, type Space } from '../model';
import { updateProfile } from '../profiles';
import { useHarness } from '../store';
import { useAgentSettings } from './AgentSettings';
import { findSetting, settingsCatalog, valueLabel, type Setting, type SettingSources, type SettingWrite } from './catalog';
import { CommitInput, FolderInput, NumberInput, SettingsChoice, SettingsRow, SettingsSelect, settingControlId } from './parts';
import { setPrefs, usePrefs } from './prefs';
import { InstructionsRow, useConfigWriter, useProfileConfig } from './ProfileAgentConfig';
import { AccountSelect, GitHubAccountSelect, IconPicker } from './sections/profiles';
import { ModelSelect, StarredModelsRow } from './sections/harnesses';
import { SimulatorSelect } from './sections/browser';

/** An agent's value for a row: shown under it with Use, until the setting holds it. */
export interface RowSuggestion {
  value: string;
  by: Author;
}

/**
 * One setting's row as Settings draws it, from the catalog: the same label, control and write, live. Settings' sections
 * and the settings widget in a thread both render these, so a setting looks and works the same in both. `idPrefix` keeps
 * ids unique when the same setting shows twice (two widgets in one thread).
 */
export function CatalogRow({ settingKey, profile, suggestion, idPrefix = '' }: { settingKey: string; profile?: Space; suggestion?: RowSuggestion; idPrefix?: string }) {
  const { sources, reload } = useSettingSources(profile, isConfigKey(settingKey));
  const setting = findSetting(settingsCatalog({ profile, config: sources.config }), settingKey);
  if (!setting) return <SettingsRow label={settingKey} description="Not a setting here any more" />;
  return <SettingRow setting={setting} sources={sources} profile={profile} rowId={idPrefix + rowIdOf(setting, profile)} suggestion={suggestion} onConfigWritten={reload} />;
}

/** Instructions, MCP servers and skills live in the profile's config files; nothing else needs them read. */
export const isConfigKey = (key: string) => /^profile\.\w+\.(instructions|mcp|skill)\b/.test(key);

/** Every source a catalog setting reads, live: prefs, theme, quiet hours, main's settings and accounts, and the profile's files when `withConfig`. */
export function useSettingSources(profile: Space | undefined, withConfig: boolean) {
  const prefs = usePrefs();
  const { theme = 'system' } = useTheme();
  const { state } = useHarness();
  const { settings, accounts } = useAgentSettings();
  const { config, reload } = useProfileConfig(withConfig ? profile?.id : undefined);
  const sources: SettingSources = { prefs, theme, quiet: state.notifications.quiet, host: settings, profile, accounts, config };
  return { sources, reload };
}

/** Deep links and search use these ids, kept from before the catalog: `alert-needs-you`, `claudePath`, `personal-name`. */
function rowIdOf(setting: Setting, profile?: Space) {
  if (setting.key.startsWith('profile.') && profile) return `${profile.id}-${setting.key.slice('profile.'.length)}`;
  if (setting.key.startsWith('alert.')) return `alert-${setting.key.slice('alert.'.length)}`;
  return setting.key.replace(/\.(\w)/g, (_, c: string) => c.toUpperCase());
}

function SettingRow({ setting, sources, profile, rowId, suggestion, onConfigWritten }: { setting: Setting; sources: SettingSources; profile?: Space; rowId: string; suggestion?: RowSuggestion; onConfigWritten: () => void }) {
  const apply = useSettingWriter(profile, onConfigWritten);
  const value = setting.read(sources);
  const set = (next: string) => {
    const write = setting.write(next, sources);
    if (write) void apply.write(write);
  };
  const line = !!suggestion && <SuggestionLine setting={setting} value={value} suggestion={suggestion} onUse={() => set(suggestion.value)} />;
  const { control } = setting;
  if (control.type === 'instructions')
    return (
      <>
        <InstructionsRow profile={profile!} provider={control.provider} config={sources.config} review={apply.review} proposal={suggestion?.value}>
          {!!suggestion && <p className="type-meta text-muted-foreground">{authorName(suggestion.by)}'s text is in the editor, not saved. Review and save it to apply.</p>}
        </InstructionsRow>
        {apply.dialog}
      </>
    );
  if (control.type === 'starredModels')
    return (
      <StarredModelsRow rowId={rowId} value={value?.split(',').filter(Boolean) ?? []} onChange={(ids) => set(ids.join(','))}>
        {line}
      </StarredModelsRow>
    );
  return (
    <>
      <SettingsRow id={rowId} label={setting.label} description={suggestion ? (setting.description ?? setting.context) : setting.description} control={value === undefined ? <Unavailable /> : <SettingControl setting={setting} value={value} rowId={rowId} onChange={set} />}>
        {line}
      </SettingsRow>
      {apply.dialog}
    </>
  );
}

const WARNING_TOGGLE = 'text-warning hover:text-warning data-[state=on]:border-warning/60 data-[state=on]:bg-warning/12 data-[state=on]:text-warning dark:data-[state=on]:bg-warning/12';

function Unavailable() {
  return <span className="type-meta text-muted-foreground">{host.isDesktop ? 'Reading…' : 'Needs the desktop app'}</span>;
}

function SettingControl({ setting, value, rowId, onChange }: { setting: Setting; value: string; rowId: string; onChange: (value: string) => void }) {
  const { control } = setting;
  const id = settingControlId(rowId);
  switch (control.type) {
    case 'choice':
      return <SettingsChoice id={rowId} value={value} options={control.options.map((o) => ({ ...o, className: o.tone === 'warning' ? WARNING_TOGGLE : undefined }))} onChange={onChange} />;
    case 'select':
      return <SettingsSelect id={rowId} value={value} options={control.options} onChange={onChange} className="w-56" />;
    case 'switch':
    case 'mcp':
    case 'skill':
      return <Switch id={id} checked={value === 'true'} onCheckedChange={(on) => onChange(String(on))} />;
    case 'number':
      return <NumberInput id={id} value={Number(value)} min={control.min} max={control.max} step={control.step} onCommit={(n) => onChange(String(n))} />;
    case 'text':
      if (control.isPath) return <FolderInput id={rowId} value={value} placeholder={control.placeholder} onCommit={onChange} />;
      return <CommitInput id={id} value={value} placeholder={control.placeholder} onCommit={onChange} className={control.isMono ? 'font-mono placeholder:font-sans' : undefined} />;
    case 'model':
      if (control.provider) return <ModelSelect id={rowId} provider={control.provider} value={value} emptyLabel={control.emptyLabel} onChange={onChange} />;
      return <SideChatModelPicker id={id} value={value} onChange={onChange} />;
    case 'simulator':
      return <SimulatorSelect id={rowId} value={value} onChange={onChange} />;
    case 'icon':
      return <IconPicker id={id} value={value} onChange={onChange} />;
    case 'github':
      return <GitHubAccountSelect id={rowId} value={value} onChange={onChange} />;
    case 'account':
      return <AccountSelect id={rowId} provider={control.provider} value={value} onChange={onChange} />;
    default:
      return null;
  }
}

/** `provider:model`, the way the side chat stores its default. */
function SideChatModelPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const unavailable = useUnavailableHarnesses(useHarness().state.spaceId);
  const [provider, ...model] = value.split(':');
  return <ModelPicker id={id} value={model.join(':')} provider={provider as Provider} unavailable={unavailable} onChange={(m) => onChange(`${m.harness}:${m.id}`)} />;
}

function SuggestionLine({ setting, value, suggestion, onUse }: { setting: Setting; value: string | undefined; suggestion: RowSuggestion; onUse: () => void }) {
  const who = authorName(suggestion.by);
  if (value === suggestion.value)
    return (
      <p className="flex items-center gap-1.5 type-meta text-muted-foreground">
        <TickCircle aria-hidden className="size-3.5 text-success" />
        Set to {who}'s suggestion
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-muted-foreground">
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {who} suggests <span className="font-medium text-foreground">{valueLabel(setting, suggestion.value)}</span>
      </span>
      <Button variant="outline" size="xs" onClick={onUse} disabled={value === undefined}>
        Use
      </Button>
    </div>
  );
}

/**
 * Applies a catalog write the way Settings does: prefs and quiet hours in the renderer, main's settings and account links
 * through the host, profile fields in `src/profiles.ts`, config files through the diff review (`dialog` renders it).
 */
function useSettingWriter(profile: Space | undefined, onConfigWritten: () => void) {
  const { setTheme } = useTheme();
  const { state, dispatch } = useHarness();
  const agent = useAgentSettings();
  const { review, dialog } = useConfigWriter(profile?.id ?? '', onConfigWritten);
  const write = async (w: SettingWrite): Promise<boolean> => {
    switch (w.to) {
      case 'prefs':
        setPrefs(w.patch);
        // The store reads demo data once at startup; your own threads are saved before the reload.
        if ('demoData' in w.patch) location.reload();
        return true;
      case 'theme':
        setTheme(w.theme);
        return true;
      case 'quiet':
        dispatch({ type: 'notify-quiet', quiet: { ...state.notifications.quiet, ...w.patch } });
        return true;
      case 'host':
        return (await agent.update(w.patch)) !== false;
      case 'profile':
        updateProfile(profile!.id, w.patch);
        return true;
      case 'account':
        return agent.linkAccount(profile!.id, w.provider, w.accountId);
      case 'config':
        return review(w.title, w.changes);
    }
  };
  return { write, review, dialog };
}

