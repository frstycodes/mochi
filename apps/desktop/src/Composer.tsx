import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useAnimate, useReducedMotionConfig } from 'motion/react';
import { toast } from '@/toast/store';
import {
  ArrowUp,
  ClipboardList,
  Hand,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  Stop,
} from '@/icons';
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import { openFiles, type ViewerFile } from './files/viewer';
import { BranchIcon, BranchName } from './git/BranchLabel';
import { branchText } from './git/workspace';
import { openPhotos } from './photo/photos';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { AutoHeight } from '@/components/ui/auto-height';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MetaChip } from './MetaChip';
import type { Provider, Repo } from './model';
import {
  EffortPicker,
  ModelPicker,
  SpeedPicker,
  useModels,
} from './ModelControls';
import { optionFor, type ModelOption } from './runtime/models';
import { useSpace } from './store';
import type { ThreadControls } from './runtime/controls';
import { accessFor, PERMISSIONS, type Access } from './runtime/access';
import type { SlashItem } from './chat/slash';
import { ComposerEditor } from './chat/ComposerEditor';
import { clearDraft, getDraft, saveDraft, type DraftFile } from './chat/drafts';
import {
  IMAGE_ERRORS,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from './chat/images';

// Sending from a new thread hands its composer to the thread's: both carry the same layoutId, so one card travels down instead of two swapping.
// Each new thread page takes a fresh id, so nothing mounted later animates from a composer that already docked.
const handoffs = new Map<string, string>();
let nextHandoff = 0;
export const HANDOFF_TRANSITION = {
  duration: 0.35,
  ease: [0.32, 0.72, 0, 1],
} as const;

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
  return {
    isHandoff: !!layoutId,
    layout: {
      layoutId: reduce ? undefined : layoutId,
      layoutCrossfade: false,
      transition: HANDOFF_TRANSITION,
    },
  };
}

/**
 * The glass card. Holds an optional tray above a ComposerInput; `isStatic` skips the height animation. `isCompact` folds it to one
 * line of text while you read back through the chat; focusing it unfolds it.
 */
export function ComposerCard({
  className,
  children,
  isStatic,
  isCompact,
  ...props
}: ComponentProps<'div'> & { isStatic?: boolean; isCompact?: boolean }) {
  const [foldRef, isFolded] = useFoldCrossfade(isCompact);
  return (
    <div
      data-compact={isFolded || undefined}
      className={cn(
        'group/composer surface-glass-focus overflow-hidden rounded-2xl border shadow-composer transition-[border-color] duration-150 has-[.cm-focused]:border-foreground/16 [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent',
        // `!` beats the editor's own theme, which CodeMirror injects after our styles.
        isFolded &&
          'cursor-text [&_.cm-content]:min-h-0! [&_.cm-content]:py-0! [&_.cm-scroller]:max-h-[1lh]! [&_.cm-scroller]:overflow-hidden! [&_[data-slot=input-group]]:flex-row',
        className,
      )}
      {...props}
    >
      {isStatic ? (
        children
      ) : (
        <AutoHeight className="justify-end">
          <div ref={foldRef} className="origin-bottom">
            {children}
          </div>
        </AutoHeight>
      )}
    </div>
  );
}

/**
 * Folding or unfolding is a blur crossfade: the old layout blurs out and shrinks slightly, the card swaps layout while hidden, and
 * the new layout blurs back in as AutoHeight springs the height. Returns the layout to show, which trails `isCompact` by the
 * fade-out. Reduced motion swaps at once and only fades in.
 */
function useFoldCrossfade(isCompact = false) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotionConfig();
  const [shown, setShown] = useState(isCompact);
  // The layout the fade-out just swapped to, so only that swap fades in.
  const swappedTo = useRef<boolean | null>(null);

  useEffect(() => {
    const el = scope.current;
    if (shown === isCompact || !el) return;
    const out = animate(
      el,
      { opacity: 0, filter: 'blur(4px)', scale: 0.98 },
      { duration: reduce ? 0 : 0.09, ease: 'linear' },
    );
    let isCancelled = false;
    void out.then(() => {
      if (isCancelled) return;
      swappedTo.current = isCompact;
      setShown(isCompact);
    });
    return () => {
      isCancelled = true;
      out.stop();
    };
  }, [isCompact, shown, reduce, scope, animate]);

  useEffect(() => {
    const el = scope.current;
    if (swappedTo.current !== shown || !el) return;
    swappedTo.current = null;
    const into = animate(
      el,
      reduce
        ? { opacity: 1, filter: 'blur(0px)', scale: 1 }
        : {
            opacity: [0, 1],
            filter: ['blur(4px)', 'blur(0px)'],
            scale: [0.98, 1],
          },
      { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
    );
    // A leftover filter would make the card a containing block for anything fixed inside it.
    void into.then(() => el.style.removeProperty('filter'));
    return () => into.stop();
  }, [shown, reduce, scope, animate]);

  return [scope, shown] as const;
}

type ComposerInputProps = Omit<
  ComponentProps<typeof ComposerEditor>,
  'items'
> & {
  controls: ThreadControls;
  provider: Provider;
  /** Keeps the model list to `provider`. */
  isLocked?: boolean;
  /** The model picker alone, no effort or speed: the settings chat. */
  isModelOnly?: boolean;
  onControlsChange: (controls: ThreadControls, model?: ModelOption) => void;
  /** `/` commands and skills a token in the text can resolve to. */
  slashItems: SlashItem[];
  /** Return `false` to hold the message: the text stays in the input. */
  onSend: (
    message: PromptInputMessage,
  ) => void | boolean | Promise<void | boolean>;
  /** Set while the agent works: the send button becomes Stop. */
  onStop?: () => void;
  submitLabel?: string;
  /** Beside send: the context ring. */
  meter?: ReactNode;
  /** Mentions sit outside the text and attachments, but still make a message worth sending. */
  hasMentions?: boolean;
  /** Where the unsent text and attachments are kept (`threadDraftKey`, `newThreadDraftKey`); sending clears it. */
  draftKey: string;
  /** Kept with the draft; memoize it, a new object saves again. */
  draftExtra?: unknown;
};

export function ComposerInput({
  controls,
  provider,
  isLocked,
  isModelOnly,
  onControlsChange,
  slashItems,
  onSend,
  onStop,
  submitLabel = 'Send',
  meter,
  hasMentions,
  draftKey,
  draftExtra,
  className,
  ...editorProps
}: ComposerInputProps) {
  const catalog = useModels(useSpace().id);
  const model = optionFor(catalog[provider], controls.model, provider);
  const draft = useComposerDraft(draftKey, draftExtra);
  const isEmpty = useIsComposerEmpty() && !hasMentions;
  const send = async (message: PromptInputMessage) => {
    const result = await onSend(message);
    if (result !== false) draft.clear();
    hold(result);
  };
  return (
    <PromptInput
      multiple
      globalDrop
      accept={IMAGE_TYPES.join(',')}
      maxFileSize={MAX_IMAGE_BYTES}
      maxFiles={MAX_IMAGES}
      onError={(e) => toast.error(IMAGE_ERRORS[e.code])}
      onSubmit={send}
    >
      <ComposerAttachments />
      <PromptInputBody>
        <ComposerEditor
          items={slashItems}
          className={cn('type-prose max-md:text-base', className)}
          {...editorProps}
        />
      </PromptInputBody>
      <PromptInputFooter className="px-2.5 pt-1 pb-2.5 group-data-compact/composer:w-auto group-data-compact/composer:p-1.5">
        {/* No chevrons: the pickers read as controls without them, and the footer stays quiet. */}
        <PromptInputTools className="group-data-compact/composer:hidden [&_[data-icon=inline-end]]:hidden [&_button:has([data-icon=inline-end])]:pr-2!">
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger
              tooltip="Attach"
              className="rounded-full"
            >
              <Paperclip className="size-4" />
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <ModelPicker
            value={controls.model}
            provider={provider}
            isLocked={isLocked}
            onChange={(m) => onControlsChange({ ...controls, model: m.id }, m)}
          />
          {!isModelOnly && (
            <EffortPicker
              model={model}
              value={controls.effort}
              onChange={(effort) => onControlsChange({ ...controls, effort })}
            />
          )}
          {!isModelOnly && (
            <SpeedPicker
              model={model}
              value={controls.speed}
              onChange={(speed) => onControlsChange({ ...controls, speed })}
            />
          )}
        </PromptInputTools>
        <PromptInputTools>
          <span className="contents group-data-compact/composer:hidden">
            {meter}
          </span>
          {onStop ? (
            <PromptInputSubmit
              status="streaming"
              onStop={onStop}
              aria-label="Stop the agent"
              className="rounded-full"
            >
              <Stop filled className="size-3.5" />
            </PromptInputSubmit>
          ) : (
            <PromptInputSubmit
              aria-label={submitLabel}
              data-empty={isEmpty || undefined}
              className="rounded-full data-empty:bg-foreground/8 data-empty:text-subtle-foreground"
            >
              <ArrowUp className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}

/** No text and no attachment. The send button only dims: what to do with an empty send stays the caller's call. */
function useIsComposerEmpty() {
  const { textInput, attachments } = usePromptInputController();
  return !textInput.value.trim() && attachments.files.length === 0;
}

// PromptInput clears the input after onSubmit unless it throws (or rejects); it swallows the throw.
function hold(result: void | boolean) {
  if (result === false) throw new Error('Message held');
}

/** Puts the saved draft back into the composer once, then saves every change; needs the composer's `PromptInputProvider`. */
function useComposerDraft(key: string, extra: unknown) {
  const { textInput, attachments } = usePromptInputController();
  const [isRestored, setIsRestored] = useState(false);
  const didRestore = useRef(false);
  const blobs = useRef(new Map<string, Promise<Blob>>());
  // Blobs resolve async: only the newest save lands, and a send drops any still in flight.
  const seq = useRef(0);
  const text = textInput.value;
  const { files } = attachments;

  useEffect(() => {
    // A ref, not the state: StrictMode runs this twice before the state updates, and the files would be added twice.
    if (didRestore.current) return;
    didRestore.current = true;
    const saved = getDraft(key);
    if (saved) {
      textInput.setInput(saved.text);
      attachments.add(
        saved.files.map(
          (f) =>
            new File([f.blob], f.filename ?? 'Attachment', {
              type: f.mediaType,
            }),
        ),
      );
    }
    setIsRestored(true);
  }, [key, textInput, attachments]);

  useEffect(() => {
    if (!isRestored) return;
    const n = ++seq.current;
    const blobOf = (url: string) =>
      blobs.current.get(url) ??
      blobs.current
        .set(
          url,
          fetch(url).then((r) => r.blob()),
        )
        .get(url)!;
    Promise.all(files.map((f) => blobOf(f.url)))
      .then((list) => {
        if (n !== seq.current) return;
        const kept: DraftFile[] = files.map((f, i) => ({
          filename: f.filename,
          mediaType: f.mediaType,
          blob: list[i],
        }));
        saveDraft(key, { text, files: kept, extra });
      })
      .catch((error: unknown) =>
        console.error('Reading an attachment for the draft failed', error),
      );
  }, [isRestored, key, text, files, extra]);

  return {
    clear: () => {
      seq.current++;
      clearDraft(key);
    },
  };
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
            <Attachment
              key={f.id}
              data={f}
              onRemove={() => remove(f.id)}
              className="size-16 overflow-visible rounded-lg border"
            >
              <button
                type="button"
                aria-label={`View ${f.filename ?? 'image'}`}
                onClick={() =>
                  openPhotos({ photos: images.map(toPhoto), index: i })
                }
                className="size-full cursor-zoom-in overflow-hidden rounded-lg"
              >
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
              <button
                type="button"
                aria-label={`View ${f.filename ?? 'file'}`}
                onClick={() =>
                  openFiles({ files: others.map(toViewerFile), index: i })
                }
                className="flex min-w-0 cursor-pointer items-center gap-1.5"
              >
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

const toPhoto = (f: { url?: string; filename?: string }) => ({
  src: f.url ?? '',
  name: f.filename ?? 'Image',
});
const toViewerFile = (f: {
  url?: string;
  filename?: string;
  mediaType?: string;
}): ViewerFile => ({
  source: 'attachment',
  name: f.filename ?? 'File',
  url: f.url ?? '',
  mediaType: f.mediaType,
});

/** One line under the card for where and how the agent runs, wrapping on a phone. The gradient fades the transcript scrolling under it. */
export function ComposerMeta({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'relative flex min-h-8 flex-wrap items-center gap-1.5 px-1 pt-2 type-caption text-subtle-foreground before:absolute before:-inset-x-6 before:-top-6 before:-bottom-6 before:-z-10 before:bg-linear-to-t before:from-background before:from-65% before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The harness's own modes with what each does there. Full access is warning-coloured wherever it shows, and the first pick
 * per thread asks for a second click inside the menu.
 */
export function PermissionsMenu({
  threadId,
  provider,
  value,
  onChange,
  className,
}: {
  threadId: string;
  provider: Provider;
  value: Access;
  onChange: (access: Access) => void;
  className?: string;
}) {
  const [isArmed, setIsArmed] = useState(false);
  const access = accessFor(provider, value);
  const modes = Object.entries(PERMISSIONS[provider]) as [
    Access,
    { hint: string },
  ][];
  const needsConfirm = (mode: Access) =>
    mode === 'Full access' &&
    access !== mode &&
    !fullAccessConfirmed.has(threadId) &&
    !isArmed;
  const choose = (mode: Access) => {
    if (needsConfirm(mode)) return setIsArmed(true);
    if (mode === 'Full access') fullAccessConfirmed.add(threadId);
    onChange(mode);
  };
  return (
    <DropdownMenu onOpenChange={(open) => !open && setIsArmed(false)}>
      <DropdownMenuTrigger asChild>
        <MetaChip
          className={cn(
            className,
            access === 'Full access' &&
              'bg-warning/12 text-warning hover:bg-warning/20 hover:text-warning aria-expanded:bg-warning/20 aria-expanded:text-warning dark:bg-warning/12 dark:hover:bg-warning/20',
          )}
          aria-label={`Permissions: ${access}`}
        >
          <AccessIcon access={access} />
          {access}
        </MetaChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-76">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Permissions</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={access}
            onValueChange={(v) => choose(v as Access)}
          >
            {modes.map(([mode, { hint }]) => {
              const isFull = mode === 'Full access';
              return (
                // Radix changes the value whether or not onSelect is prevented; preventing only keeps the menu open for the confirm.
                <DropdownMenuRadioItem
                  key={mode}
                  value={mode}
                  onSelect={(e) => needsConfirm(mode) && e.preventDefault()}
                  className={cn(
                    'items-start py-1.5',
                    isFull && 'text-warning focus:**:text-warning',
                  )}
                >
                  <AccessIcon access={mode} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    {mode}
                    <span
                      className={cn(
                        'type-caption text-muted-foreground',
                        isFull && isArmed && 'text-warning',
                      )}
                    >
                      {isFull && isArmed
                        ? 'Choose again to turn on: nothing will ask before it runs'
                        : hint}
                    </span>
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

const ACCESS_ICONS = {
  Manual: Hand,
  Auto: ShieldCheck,
  'Full access': ShieldAlert,
  Plan: ClipboardList,
} satisfies Record<Access, unknown>;

function AccessIcon({
  access,
  className,
}: {
  access: Access;
  className?: string;
}) {
  const Icon = ACCESS_ICONS[access];
  return <Icon aria-hidden className={className} />;
}

/** Where a started thread works: its project folder or its own worktree, and the branch. Not a control, so it takes no hover. */
export function BranchLabel({ repo }: { repo: Repo }) {
  return (
    <span className="flex h-7 min-w-0 items-center gap-1.5 px-2">
      <BranchIcon repo={repo} />
      <BranchName repo={repo} title={branchText(repo)} />
    </span>
  );
}

/** Meta chips joined into one filled chip, a hairline between each, like the new thread's branch | worktree. */
export function MetaGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      className={cn(
        'flex h-7 min-w-0 items-center rounded-lg bg-foreground/5 [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:inset-y-1.75 [&>*+*]:before:left-0 [&>*+*]:before:w-px [&>*+*]:before:bg-foreground/15',
        className,
      )}
      {...props}
    />
  );
}
