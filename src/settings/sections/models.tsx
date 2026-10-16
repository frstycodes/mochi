import type { ReactNode } from 'react';
import { ChevronDown } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ModelMenu, useListedModels, useModels } from '../../ModelControls';
import { optionFor, type ModelOption } from '../../runtime/models';
import { useSpace } from '../../store';
import type { Provider } from '../../model';
import { ProviderMark } from '../../ui';
import { UTILITY_TASKS } from '../../utility/prompts';
import { CatalogRow } from '../CatalogRow';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { SettingsGroup, SettingsRow, SettingsSelect, settingControlId } from '../parts';
import { toggleStar } from '../prefs';

/** Every model choice in one place: the composer's, each harness's defaults, side chats and background tasks. */
export function ModelsSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup id="starredModels" title="Composer" footer="Starred models show up when you scroll over the composer's model button. The lists are this profile's accounts' own.">
        <CatalogRow settingKey="starredModels" />
        <CatalogRow settingKey="effort" />
        <CatalogRow settingKey="speed" />
      </SettingsGroup>
      {HARNESS_IDS.map((provider) => (
        <SettingsGroup key={provider} title={<HarnessTitle provider={provider} />}>
          <CatalogRow settingKey={`${provider}.model`} label="Default model" />
          <CatalogRow settingKey={`${provider}.secondOpinionModel`} label="Second opinion model" />
        </SettingsGroup>
      ))}
      <SettingsGroup title="Side chats">
        <CatalogRow settingKey="sideChatModel" />
      </SettingsGroup>
      <SettingsGroup title="Background tasks" footer="Each runs through this profile's account, falling back to Haiku 5.5, then GPT-6-Luna, on whichever is signed in. Generated titles never replace one you renamed, and drafts are yours to edit before anything is sent.">
        {UTILITY_TASKS.map((task) => (
          <CatalogRow key={task} settingKey={`utility.${task}`} />
        ))}
      </SettingsGroup>
    </div>
  );
}

function HarnessTitle({ provider }: { provider: Provider }) {
  return (
    <span className="flex items-center gap-2">
      <ProviderMark provider={provider} />
      {HARNESSES[provider].name}
    </span>
  );
}

/** The model menu in star mode: picking a model stars or unstars it, and the menu stays open. */
export function StarredModelsRow({ rowId, value: starredModels, onChange, children }: { rowId: string; value: string[]; onChange: (ids: string[]) => void; children?: ReactNode }) {
  const { catalog, harnesses } = useListedModels(useSpace().id);
  const models = harnesses.flatMap((h) => (catalog[h] ?? []).map((m): ModelOption => ({ ...m, harness: h })));
  const starred = models.filter((m) => starredModels.includes(m.id));
  return (
    <SettingsRow
      id={rowId}
      label="Starred models"
      description={starred.map((m) => m.name).join(', ') || 'None starred yet'}
      control={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id={settingControlId(rowId)} variant="outline" size="sm">
              Choose models
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <ModelMenu
            models={models}
            pending={harnesses.filter((h) => !catalog[h])}
            harnesses={harnesses}
            isChecked={(m) => starredModels.includes(m.id)}
            onPick={(m) => onChange(toggleStar(starredModels, m.id))}
            keepsOpen
            align="end"
          />
        </DropdownMenu>
      }
    >
      {children}
    </SettingsRow>
  );
}

// Radix Select reserves '': the account's own default gets a sentinel.
const ACCOUNT_DEFAULT = 'account-default';

/** The current profile's list for `provider`, its account default first; a saved model the account no longer offers stays listed as Unavailable. */
export function ModelSelect({ id, provider, value, emptyLabel, onChange }: { id: string; provider: Provider; value: string; emptyLabel?: string; onChange: (model: string) => void }) {
  const models = useModels(useSpace().id)[provider];
  const stored = optionFor(models, value, provider);
  const fallback = optionFor(models, '', provider);
  const options = [
    { value: ACCOUNT_DEFAULT, label: emptyLabel ?? (models?.length ? `Account default (${fallback.name})` : 'Account default') },
    ...(models ?? []).map((m) => ({ value: m.id, label: m.name })),
    ...(value && !models?.some((m) => m.id === value) ? [{ value, label: stored.isUnavailable ? `${value} (Unavailable)` : value }] : []),
  ];
  return <SettingsSelect id={id} value={value || ACCOUNT_DEFAULT} options={options} onChange={(v) => onChange(v === ACCOUNT_DEFAULT ? '' : v)} className="w-56" />;
}

