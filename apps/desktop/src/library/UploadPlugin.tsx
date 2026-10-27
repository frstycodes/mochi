import { Badge } from '@/components/ui/badge';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useQuery } from '@tanstack/react-query';
import {
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Terminal, Upload, Warning, XCircle } from '@/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { toast } from '@/toast/store';
import { host } from '../host';
import type { Provider } from '../model';
import { useProfiles } from '../profiles';
import { ipcMessage } from '../settings/AgentSettings';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses';
import { ProviderMark, SpaceIcon } from '../ui';
import type { PluginReview } from './library';
import { countOf, LibraryIcon, LIST } from './LibraryParts';
import type { Library } from './useLibrary';
import { queryKeys } from '../queryKeys';

/**
 * Plugins › Add plugin › Plugin file: a file from the picker (`fileInput`, which the menu clicks) or dropped on the page,
 * read in main, reviewed here, then installed.
 */
export function UploadPluginDialog({
  library,
  fileInput,
}: {
  library: Library;
  fileInput: RefObject<HTMLInputElement | null>;
}) {
  const file = usePendingUpload();
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) setPendingUpload(picked);
        }}
      />
      <Dialog
        open={!!file}
        onOpenChange={(isOpen) => !isOpen && setPendingUpload(null)}
      >
        <DialogContent className="flex max-h-[min(720px,calc(100dvh-4rem))] flex-col sm:max-w-lg">
          {!!file && (
            <UploadReview
              key={`${file.name}:${file.lastModified}:${file.size}`}
              file={file}
              library={library}
              onPickAnother={() => fileInput.current?.click()}
              onDone={() => setPendingUpload(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Dropping a file anywhere on the page opens the same review; a hairline overlay says so while one is dragged over. */
export function PluginDropZone({ children }: { children: ReactNode }) {
  const [isOver, setOver] = useState(false);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) =>
        !e.currentTarget.contains(e.relatedTarget as Node | null) &&
        setOver(false)
      }
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped) setPendingUpload(dropped);
      }}
    >
      {children}
      {isOver && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-2 z-10 flex items-center justify-center rounded-xl border border-dashed border-foreground/30 bg-background/85"
        >
          <span className="flex items-center gap-2 type-body font-medium">
            <Upload className="size-4" />
            Drop to review the plugin
          </span>
        </div>
      )}
    </div>
  );
}

const UPLOAD_ACCEPT = '.plugin,.zip,.tar.gz,.tgz,.tar';
const MAX_UPLOAD_BYTES = 20_000_000;

// {PENDING FILE}

// Shared by the header's picker and the page's drop zone, which sit in different parts of the page.
const pendingStore = createStore<{ file: File | null }>(() => ({
  file: null,
}));

function setPendingUpload(file: File | null) {
  pendingStore.setState({ file });
}

function usePendingUpload() {
  return useStore(pendingStore, (s) => s.file);
}

// {REVIEW}

type Read =
  | { status: 'reading' }
  | { status: 'error'; message: string }
  | { status: 'done'; review: PluginReview; bytes: Uint8Array };

function useReview(file: File) {
  const reviewQuery = useQuery({
    queryKey: queryKeys.library.uploadReview(file),
    queryFn: async () => {
      if (file.size > MAX_UPLOAD_BYTES)
        throw new Error(`The file is over ${MAX_UPLOAD_BYTES / 1_000_000} MB`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return {
        review: await host.library.reviewUpload({ name: file.name, bytes }),
        bytes,
      };
    },
    gcTime: 0,
    staleTime: 0,
  });
  const read: Read = reviewQuery.data
    ? { status: 'done', ...reviewQuery.data }
    : reviewQuery.error
      ? { status: 'error', message: ipcMessage(reviewQuery.error) }
      : { status: 'reading' };
  return read;
}

function UploadReview({
  file,
  library,
  onPickAnother,
  onDone,
}: {
  file: File;
  library: Library;
  onPickAnother: () => void;
  onDone: () => void;
}) {
  const read = useReview(file);
  if (read.status === 'reading') return <ReadingState name={file.name} />;
  if (read.status === 'error')
    return (
      <UploadErrorState
        name={file.name}
        message={read.message}
        onPickAnother={onPickAnother}
        onClose={onDone}
      />
    );
  return (
    <ReviewForm
      review={read.review}
      file={{ name: file.name, bytes: read.bytes }}
      library={library}
      onDone={onDone}
    />
  );
}

function ReadingState({ name }: { name: string }) {
  return (
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <Spinner />
        Reading {name}…
      </DialogTitle>
      <DialogDescription>
        Unpacking it to see what it adds. Nothing is installed yet.
      </DialogDescription>
    </DialogHeader>
  );
}

function UploadErrorState({
  name,
  message,
  onPickAnother,
  onClose,
}: {
  name: string;
  message: string;
  onPickAnother: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Can’t install {name}</DialogTitle>
        <DialogDescription>Nothing was installed.</DialogDescription>
      </DialogHeader>
      <p
        role="alert"
        className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/8 px-3 py-2 type-meta text-destructive"
      >
        <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 break-words">{message}</span>
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onPickAnother}>Choose another file</Button>
      </DialogFooter>
    </>
  );
}

function ReviewForm({
  review,
  file,
  library,
  onDone,
}: {
  review: PluginReview;
  file: { name: string; bytes: Uint8Array };
  library: Library;
  onDone: () => void;
}) {
  const profiles = useProfiles();
  const [targets, setTargets] = useState<Provider[]>(() =>
    HARNESS_IDS.filter((p) => !!review.loads[p]),
  );
  const [profileIds, setProfileIds] = useState<string[]>(library.installTo);
  const [error, setError] = useState<string | null>(null);
  const [isInstalling, setInstalling] = useState(false);
  const runs =
    review.hooks.filter((h) => h.type === 'command').length +
    review.servers.length;
  const meta = [
    review.version && `v${review.version}`,
    review.author && `by ${review.author}`,
    review.file,
  ]
    .filter(Boolean)
    .join(' · ');
  const install = () => {
    setInstalling(true);
    setError(null);
    library
      .installUpload(file, { sha256: review.sha256, targets, profileIds })
      .then(
        () => {
          toast.success(
            review.existing
              ? `${review.title} replaced`
              : `${review.title} installed`,
          );
          onDone();
        },
        (e: Error) => {
          setError(ipcMessage(e));
          setInstalling(false);
        },
      );
  };
  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 text-left">
        <LibraryIcon url={null} letter={review.title} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle className="truncate">
            {review.existing
              ? `Replace ${review.existing.title}?`
              : `Install ${review.title}?`}
          </DialogTitle>
          <DialogDescription className="truncate">{meta}</DialogDescription>
        </div>
      </DialogHeader>
      <div className="-mx-4 flex min-h-0 flex-col gap-5 overflow-y-auto px-4">
        {!!review.description && (
          <p className="type-meta text-pretty text-muted-foreground">
            {review.description}
          </p>
        )}
        {runs > 0 && (
          <p
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/8 px-3 py-2 type-meta text-warning"
          >
            <Warning aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              It runs {countOf(runs, 'command')} on your computer once it’s in a
              thread. Read them below before you install it.
            </span>
          </p>
        )}
        {!!review.existing && (
          <p className="type-meta text-muted-foreground">
            Your library already has {review.existing.title}
            {review.existing.isUpload
              ? ' from an upload'
              : ' from a marketplace'}
            . This replaces it and keeps the profiles it’s in.
          </p>
        )}
        <Parts
          title="Skills and commands"
          count={review.skills.length}
          note="Commands install as skills."
        >
          {review.skills.map((s) => (
            <NamedRow key={s.name} name={s.name} description={s.description} />
          ))}
        </Parts>
        <Parts title="Agents" count={review.agents.length}>
          {review.agents.map((a) => (
            <NamedRow key={a.name} name={a.name} description={a.description} />
          ))}
        </Parts>
        <Parts title="Hooks" count={review.hooks.length}>
          {review.hooks.map((h, i) => (
            <CommandRow
              key={i}
              name={[h.event, h.matcher, h.condition]
                .filter(Boolean)
                .join(' · ')}
              run={h.run}
              isCommand={h.type === 'command'}
            />
          ))}
        </Parts>
        <Parts title="MCP servers" count={review.servers.length}>
          {review.servers.map((s) => (
            <CommandRow
              key={s.name}
              name={s.name}
              run={s.run}
              isCommand
              note={s.env.length ? `Sets ${LIST.format(s.env)}` : undefined}
            />
          ))}
        </Parts>
        <Parts
          title="Connectors"
          count={review.remotes.length}
          note="Remote servers become connectors: sign in under Connectors once it’s installed."
        >
          {review.remotes.map((r) => (
            <NamedRow key={r.name} name={r.name} description={r.url} />
          ))}
        </Parts>
        {review.unsupported.length + review.skipped.length > 0 && (
          <Parts
            title="Left out"
            count={review.unsupported.length + review.skipped.length}
          >
            {review.unsupported.map((label) => (
              <NamedRow
                key={label}
                name={label}
                description="Neither harness loads this from Mochi"
              />
            ))}
            {review.skipped.map((path) => (
              <NamedRow
                key={path}
                name={path}
                description="Not a text file, or too large to store"
              />
            ))}
          </Parts>
        )}
        <Choices title="Install for">
          {HARNESS_IDS.map((provider) => (
            <Choice
              key={provider}
              label={HARNESSES[provider].name}
              hint={review.loads[provider] ?? 'Nothing in it loads here'}
              icon={<ProviderMark provider={provider} size={14} />}
              isDisabled={!review.loads[provider]}
              isChecked={targets.includes(provider)}
              onChange={(isOn) =>
                setTargets((all) => toggled(all, provider, isOn))
              }
            />
          ))}
        </Choices>
        <Choices title="Profiles that get it">
          {profiles.map((p) => (
            <Choice
              key={p.id}
              label={p.name}
              icon={<SpaceIcon space={p} className="size-3.5" />}
              isChecked={profileIds.includes(p.id)}
              onChange={(isOn) =>
                setProfileIds((all) => toggled(all, p.id, isOn))
              }
            />
          ))}
        </Choices>
      </div>
      {!!error && (
        <p role="alert" className="type-meta text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!targets.length || isInstalling} onClick={install}>
          {isInstalling && <Spinner data-icon="inline-start" />}
          {review.existing ? 'Replace plugin' : 'Install plugin'}
        </Button>
      </DialogFooter>
    </>
  );
}

const toggled = <T,>(list: T[], value: T, isOn: boolean) =>
  isOn
    ? [...list.filter((v) => v !== value), value]
    : list.filter((v) => v !== value);

function Parts({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note?: string;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-baseline gap-1.5 type-meta font-semibold">
        {title}
        <span className="font-normal text-subtle-foreground tabular">
          {count}
        </span>
      </h3>
      {!!note && <p className="type-caption text-muted-foreground">{note}</p>}
      <ul className="flex flex-col divide-y rounded-lg border">{children}</ul>
    </section>
  );
}

function NamedRow({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <span className="truncate type-meta font-medium">{name}</span>
      {!!description && (
        <span className="line-clamp-2 type-caption break-words text-muted-foreground">
          {description}
        </span>
      )}
    </li>
  );
}

/** A hook or server: what runs, verbatim, flagged when it's a command on this computer. */
function CommandRow({
  name,
  run,
  isCommand,
  note,
}: {
  name: string;
  run: string;
  isCommand: boolean;
  note?: string;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2">
      <span className="flex items-center gap-2">
        <span className="min-w-0 truncate type-meta font-medium">{name}</span>
        {isCommand && (
          <Badge tone="warning">
            <Terminal aria-hidden />
            Runs a command
          </Badge>
        )}
      </span>
      <code className="rounded-[6px] bg-muted px-2 py-1.5 font-mono type-caption break-all whitespace-pre-wrap [corner-shape:round]!">
        {run}
      </code>
      {!!note && (
        <span className="type-caption text-muted-foreground">{note}</span>
      )}
    </li>
  );
}

function Choices({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 type-meta font-semibold">{title}</legend>
      <div className="flex flex-col divide-y rounded-lg border">{children}</div>
    </fieldset>
  );
}

function Choice({
  label,
  hint,
  icon,
  isChecked,
  isDisabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  icon: ReactNode;
  isChecked: boolean;
  isDisabled?: boolean;
  onChange: (isOn: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 px-3 py-2',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <Checkbox
        checked={isChecked && !isDisabled}
        disabled={isDisabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate type-meta">{label}</span>
      {!!hint && (
        <span className="shrink-0 type-caption text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
