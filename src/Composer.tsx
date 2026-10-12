import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { ArrowUp, BranchUp, ClipboardList, Folder, Hand, Laptop, Mic, Monitor, Paperclip, ShieldAlert, ShieldCheck, Stop } from 'reicon-react';
import { toast } from 'sonner';
import { Attachment, AttachmentInfo, AttachmentPreview, AttachmentRemove, Attachments } from '@/components/ai-elements/attachments';
import { openFiles, type ViewerFile } from './files/viewer';
import { openPhotos } from './photo/photos';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { AutoHeight } from '@/components/ui/auto-height';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Provider, Repo } from './model';
import { EffortPicker, ModelPicker, useModels } from './ModelControls';
import { optionFor, type ModelOption } from './runtime/models';
import { useSpace } from './store';
import type { ThreadControls } from './runtime/controls';
import { accessFor, PERMISSIONS, type Access } from './runtime/access';
import { getPrefs, type Prefs } from './settings/prefs';
import type { SlashItem } from './chat/slash';
import { TokenTextarea } from './chat/SlashToken';

// Sending from a new thread hands its composer to the thread's: both carry the same layoutId, so one card travels down instead of two swapping.
// Each new thread page takes a fresh id, so nothing mounted later animates from a composer that already docked.
const handoffs = new Map<string, string>();
let nextHandoff = 0;
export const HANDOFF_TRANSITION = { duration: 0.35, ease: [0.32, 0.72, 0, 1] } as const;

export function newComposerLayoutId(leafId: string) {
  return `composer-${leafId}-${nextHandoff++}`;
}

export function handOffComposer(leafId: string, layoutId: string) {
  handoffs.set(leafId, layoutId);
}

export function isHandingOff(leafId: string) {
  return handoffs.has(leafId);
}

/** The thread composer takes over the card only when it receives a handoff. Reduced motion: no move, the new thread page crossfades out. */
export function useComposerHandoff(leafId: string) {
  const reduce = useReducedMotionConfig();
  const [layoutId] = useState(() => handoffs.get(leafId));
  useEffect(() => {
    handoffs.delete(leafId);
  }, [leafId]);
  return { isHandoff: !!layoutId, layout: { layoutId: reduce ? undefined : layoutId, layoutCrossfade: false, transition: HANDOFF_TRANSITION } };
}

/** The glass card. Holds an optional tray above a ComposerInput. */
export function ComposerCard({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('surface-glass overflow-hidden rounded-2xl border shadow-lift transition-colors has-[textarea:focus]:border-primary/30 [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent', className)} {...props}>
      <AutoHeight className="justify-end">{children}</AutoHeight>
    </div>
  );
}

type ComposerInputProps = Omit<ComponentProps<typeof TokenTextarea>, 'items' | 'onSubmit'> & {
  controls: ThreadControls;
  provider: Provider;
  /** Keeps the model list to `provider`. */
  isLocked?: boolean;
  onControlsChange: (controls: ThreadControls, model?: ModelOption) => void;
  /** `/` commands and skills a token in the text can resolve to. */
  slashItems: SlashItem[];
  /** Return `false` to hold the message: the text stays in the input. */
  onSend: (message: PromptInputMessage) => void | boolean;
  /** Set while the agent works: the send button becomes Stop. */
  onStop?: () => void;
  submitLabel?: string;
};

export function ComposerInput({ controls, provider, isLocked, onControlsChange, slashItems, onSend, onStop, submitLabel = 'Send', className, ...textareaProps }: ComposerInputProps) {
  const model = optionFor(useModels(useSpace().id)[provider], controls.model, provider);
  return (
    <PromptInput multiple globalDrop onSubmit={(message) => hold(onSend(message))}>
      <ComposerAttachments />
      <PromptInputBody>
        <TokenTextarea items={slashItems} className={cn('min-h-12 px-4 pt-3 type-prose max-md:text-base', className)} {...textareaProps} />
      </PromptInputBody>
      <PromptInputFooter className="px-2 pb-2">
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger tooltip="Attach" className="rounded-full">
              <Paperclip className="size-4" />
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <ModelPicker value={controls.model} provider={provider} isLocked={isLocked} onChange={(m) => onControlsChange({ ...controls, model: m.id }, m)} />
          <EffortPicker model={model} value={controls.effort} onChange={(effort) => onControlsChange({ ...controls, effort })} />
        </PromptInputTools>
        <PromptInputTools>
          <PromptInputButton tooltip="Dictate" className="rounded-full" onClick={() => toast('Dictation is not in the prototype yet')}>
            <Mic className="size-4" />
          </PromptInputButton>
          {onStop ? (
            <PromptInputSubmit status="streaming" onStop={onStop} aria-label="Stop the agent" className="rounded-full">
              <Stop className="size-4" />
            </PromptInputSubmit>
          ) : (
            <PromptInputSubmit aria-label={submitLabel} className="rounded-full">
              <ArrowUp className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}

// PromptInput clears the input after onSubmit unless it throws; it swallows the throw.
function hold(result: void | boolean) {
  if (result === false) throw new Error('Message held');
}

function ComposerAttachments() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;
  const images = files.filter((f) => f.mediaType?.startsWith('image/'));
  const others = files.filter((f) => !f.mediaType?.startsWith('image/'));
  return (
    <PromptInputHeader className="gap-2 px-3 pt-3">
      {images.length > 0 && (
        <Attachments variant="grid" className="ml-0">
          {images.map((f, i) => (
            // Unclipped so the remove button can stick out of the corner; the preview clips itself.
            <Attachment key={f.id} data={f} onRemove={() => remove(f.id)} className="size-16 overflow-visible rounded-lg border">
              <button type="button" aria-label={`View ${f.filename ?? 'image'}`} onClick={() => openPhotos({ photos: images.map(toPhoto), index: i })} className="size-full cursor-zoom-in overflow-hidden rounded-lg">
                <AttachmentPreview />
              </button>
              <AttachmentRemove className="-top-1.5 -right-1.5 size-5 bg-popover shadow-popover backdrop-blur-none group-focus-within:opacity-100 hover:bg-popover" />
            </Attachment>
          ))}
        </Attachments>
      )}
      {others.length > 0 && (
        <Attachments variant="inline">
          {others.map((f, i) => (
            <Attachment key={f.id} data={f} onRemove={() => remove(f.id)}>
              <button type="button" aria-label={`View ${f.filename ?? 'file'}`} onClick={() => openFiles({ files: others.map(toViewerFile), index: i })} className="flex min-w-0 cursor-pointer items-center gap-1.5">
                <AttachmentPreview />
                <AttachmentInfo className="type-caption" />
              </button>
              <AttachmentRemove />
            </Attachment>
          ))}
        </Attachments>
      )}
    </PromptInputHeader>
  );
}

const toPhoto = (f: { url?: string; filename?: string }) => ({ src: f.url ?? '', name: f.filename ?? 'Image' });
const toViewerFile = (f: { url?: string; filename?: string; mediaType?: string }): ViewerFile => ({ source: 'attachment', name: f.filename ?? 'File', url: f.url ?? '', mediaType: f.mediaType });

/** One line under the card for where and how the agent runs, wrapping on a phone. The gradient fades the transcript scrolling under it. */
export function ComposerMeta({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'relative flex min-h-8 flex-wrap items-center gap-x-1 px-1 type-caption text-subtle-foreground before:absolute before:-inset-x-6 before:-top-6 before:-bottom-6 before:-z-10 before:bg-linear-to-t before:from-background before:from-40% before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

export const DEVICES = ['This Mac', 'Studio', 'Cloud sandbox'] as const satisfies Prefs['runsOn'][];

// GAP: only This Mac runs anything; the choice isn't kept or sent to an agent.
export function RunOnMenu() {
  const [device, setDevice] = useState<string>(() => getPrefs().runsOn);
  return <MetaMenu icon={device === 'Cloud sandbox' ? <Monitor /> : <Laptop />} label="Run on" value={device} options={DEVICES} onChange={setDevice} />;
}

/**
 * The harness's own modes with what each does there. Full access is warning-coloured wherever it shows, and the first pick
 * per thread asks for a second click inside the menu.
 */
export function PermissionsMenu({ threadId, provider, value, onChange }: { threadId: string; provider: Provider; value: Access; onChange: (access: Access) => void }) {
  const [isArmed, setIsArmed] = useState(false);
  const access = accessFor(provider, value);
  const modes = Object.entries(PERMISSIONS[provider]) as [Access, { hint: string }][];
  const needsConfirm = (mode: Access) => mode === 'Full access' && access !== mode && !fullAccessConfirmed.has(threadId) && !isArmed;
  const choose = (mode: Access) => {
    if (needsConfirm(mode)) return setIsArmed(true);
    if (mode === 'Full access') fullAccessConfirmed.add(threadId);
    onChange(mode);
  };
  return (
    <DropdownMenu onOpenChange={(open) => !open && setIsArmed(false)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn('text-subtle-foreground hover:text-foreground', access === 'Full access' && 'bg-warning/12 text-warning hover:bg-warning/20 hover:text-warning aria-expanded:bg-warning/20 aria-expanded:text-warning dark:hover:bg-warning/20')}
          aria-label={`Permissions: ${access}`}
        >
          <AccessIcon access={access} />
          {access}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-76">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Permissions</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={access} onValueChange={(v) => choose(v as Access)}>
            {modes.map(([mode, { hint }]) => {
              const isFull = mode === 'Full access';
              return (
                // Radix changes the value whether or not onSelect is prevented; preventing only keeps the menu open for the confirm.
                <DropdownMenuRadioItem key={mode} value={mode} onSelect={(e) => needsConfirm(mode) && e.preventDefault()} className={cn('items-start py-1.5', isFull && 'text-warning focus:**:text-warning')}>
                  <AccessIcon access={mode} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    {mode}
                    <span className={cn('type-caption text-muted-foreground', isFull && isArmed && 'text-warning')}>{isFull && isArmed ? 'Choose again to turn on: nothing will ask before it runs' : hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ponytail: kept in memory, so a reload asks once more per thread; persist it if that grates.
const fullAccessConfirmed = new Set<string>();

const ACCESS_ICONS = { Manual: Hand, Auto: ShieldCheck, 'Full access': ShieldAlert, Plan: ClipboardList } satisfies Record<Access, unknown>;

function AccessIcon({ access, className }: { access: Access; className?: string }) {
  const Icon = ACCESS_ICONS[access];
  return <Icon aria-hidden className={className} />;
}

/** Where a started thread works: its project folder or its own worktree, and the branch. */
export function BranchLabel({ repo }: { repo: Repo }) {
  const isFolder = repo.mode === 'folder';
  return (
    <span className="flex min-w-0 items-center gap-1 px-1.5">
      {isFolder ? <Folder className="size-3.5 shrink-0" aria-label="Project folder" /> : <BranchUp className="size-3.5 shrink-0" aria-label="Own worktree" />}
      <span className="truncate">{repo.branch}</span>
    </span>
  );
}

function MetaMenu({ icon, label, value, options, onChange }: { icon: ReactNode; label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="text-subtle-foreground hover:text-foreground" aria-label={`${label}: ${value}`}>
          {icon}
          {value}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o} value={o}>
                {o}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
