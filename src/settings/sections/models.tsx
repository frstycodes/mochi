import type { ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ChevronDown } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ModelMenu, ModelPicker, useListedModels, useModels } from '../../ModelControls';
import type { ModelChoice } from '../../host/types/settings';
import { optionFor, type ModelOption } from '../../runtime/models';
import { useSpace } from '../../store';
import type { Provider } from '../../model';
import { ProviderMark } from '../../ui';
import { UTILITY_TASK_LABELS, UTILITY_TASKS } from '../../utility/prompts';
import { useAgentSettings } from '../AgentSettings';
import { useLinkedTab } from '../../routes/nav';
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
      <SettingsGroup title="Image generation" footer="Claude can't make images, so it asks this harness. Codex threads always use their own.">
        <CatalogRow settingKey="imageGen" />
      </SettingsGroup>
      <BackgroundModels />
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

/**
 * One model for every background task, which is how they're nearly always set; each task's own picker sits behind
 * "Choose per task", open while they differ or when a deep link names one.
 */
function BackgroundModels() {
  const { settings, update } = useAgentSettings();
  const [disclosure, setDisclosure] = useLinkedTab((settingId) => (settingId.startsWith('utility-') ? 'open' : undefined), 'closed');
  const models = settings?.utilityModels;
  const first = models?.[UTILITY_TASKS[0]];
  const differing = models && first ? UTILITY_TASKS.filter((task) => models[task].provider !== first.provider || models[task].model !== first.model) : [];
  const isOpen = disclosure === 'open' || differing.length > 0;
  const setAll = (choice: ModelChoice) => void update({ utilityModels: Object.fromEntries(UTILITY_TASKS.map((task) => [task, choice])) });
  return (
    <SettingsGroup title="Background tasks" footer="Each runs through this profile's account, falling back to Haiku 5.5, then GPT-6-Luna, on whichever is signed in. Generated titles never replace one you renamed, and drafts are yours to edit before anything is sent.">
      <SettingsRow
        id="backgroundModel"
        label="Model for every task"
        description={differing.length ? `Tasks differ: ${LIST.format(differing.map((task) => UTILITY_TASK_LABELS[task]))} use their own` : `Used by all ${UTILITY_TASKS.length} background tasks`}
        control={first ? <ModelPicker id={settingControlId('backgroundModel')} value={first.model} provider={first.provider} onChange={(m) => setAll({ provider: m.harness, model: m.id })} /> : <span className="type-meta text-muted-foreground">Needs the desktop app</span>}
      />
      <Collapsible open={isOpen} onOpenChange={(open) => setDisclosure(open ? 'open' : 'closed')} className="relative before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-border">
        <CollapsibleTrigger asChild>
          <button type="button" disabled={differing.length > 0} className="flex w-full items-center gap-1.5 px-4 py-2.5 type-meta text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground disabled:hover:text-muted-foreground">
            <ChevronDown aria-hidden className={cn('size-3.5 transition-transform duration-200', !isOpen && '-rotate-90')} />
            Choose per task
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {UTILITY_TASKS.map((task) => (
            <CatalogRow key={task} settingKey={`utility.${task}`} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </SettingsGroup>
  );
}

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

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

