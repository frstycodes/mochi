import type { ReactNode } from 'react';
import { FolderOpen, VideoPlay } from '@/icons';
import { toast } from '@/toast/store';
import { formatBytes } from '@mochi/domain/lib/format';
import { host } from '../host';
import type { SentFiles } from '../model';
import { useRemoteMachine } from '../remote/origin';
import { sentKind } from '../files/kinds';
import { TooltipIconButton } from '../ui';
import { REVEAL_LABEL } from './ImageGenCard';
import { revealFile, splitPath, useImageUrls } from './imageSrc';
import { MessageImages } from './MessageImages';
import { OsFileIcon } from './OsFileIcon';

type SentFile = SentFiles['files'][number];

/**
 * Files the agent sent (`send_files`): images as tiles that open the viewer, videos in a player, anything else as a file
 * with the OS's own icon that opens in its default app. On another computer's thread a video or file shows where it is
 * instead, since it can't be opened from here.
 */
export function SentFilesRow({ sent }: { sent: SentFiles }) {
  const machine = useRemoteMachine();
  const { images, videos, others } = groupSent(sent.files);
  return (
    <figure className="flex w-full max-w-md flex-col items-start gap-2">
      {images.length > 0 && (
        <MessageImages
          photos={images.map((f) => ({
            src: f.path,
            name: splitPath(f.path).name,
          }))}
        />
      )}
      {videos.map((file) =>
        machine ? (
          <FileFrame key={file.path}>
            <SentFileRow file={file} elsewhere={machine.name} />
          </FileFrame>
        ) : (
          <SentVideo key={file.path} file={file} />
        ),
      )}
      {others.map((file) => (
        <FileFrame key={file.path}>
          <SentFileRow file={file} elsewhere={machine?.name} />
        </FileFrame>
      ))}
      {!!sent.caption && (
        <figcaption className="type-meta text-muted-foreground">
          {sent.caption}
        </figcaption>
      )}
    </figure>
  );
}

function groupSent(files: SentFile[]) {
  const of = (kind: ReturnType<typeof sentKind>) =>
    files.filter((f) => sentKind(f.path) === kind);
  return { images: of('image'), videos: of('video'), others: of('file') };
}

function FileFrame({ children }: { children: ReactNode }) {
  return (
    <div className="group/file w-full overflow-hidden rounded-xl border">
      {children}
    </div>
  );
}

function SentVideo({ file }: { file: SentFile }) {
  const [url] = useImageUrls([file.path]);
  return (
    <FileFrame>
      {url === null ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 border-b bg-muted text-muted-foreground">
          <VideoPlay aria-hidden className="size-5" />
          <span className="type-meta">The video was moved or deleted</span>
        </div>
      ) : (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- an agent's screen recording has no captions to give
        <video
          src={url}
          controls
          preload="metadata"
          className="block aspect-video w-full border-b bg-black"
        />
      )}
      <SentFileRow file={file} />
    </FileFrame>
  );
}

/** The file's own row: its OS icon, name and size, opening it on click; `elsewhere` names the computer it's on when that isn't this one. */
function SentFileRow({
  file,
  elsewhere,
}: {
  file: SentFile;
  elsewhere?: string;
}) {
  const { name } = splitPath(file.path);
  return (
    <div className="flex items-center gap-1 py-1.5 ps-1.5 pe-2">
      <button
        type="button"
        disabled={!!elsewhere}
        title={elsewhere ? `On ${elsewhere}` : `Open ${name}`}
        onClick={() => openFile(file.path)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1 text-start transition-colors focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent/60"
      >
        <OsFileIcon name={name} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate type-caption text-muted-foreground tabular">
            {formatBytes(file.size)}
            {!!elsewhere && ` · on ${elsewhere}`}
          </span>
        </span>
      </button>
      {!elsewhere && (
        <TooltipIconButton
          label={REVEAL_LABEL}
          hint="Where the agent saved it"
          onClick={() => void revealFile(file.path)}
          className="transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within/file:opacity-100 pointer-fine:group-hover/file:opacity-100"
        >
          <FolderOpen />
        </TooltipIconButton>
      )}
    </div>
  );
}

function openFile(path: string) {
  host.fs.open(path).catch((error: unknown) =>
    toast.error(`Could not open ${splitPath(path).name}`, {
      description: error instanceof Error ? error.message : String(error),
    }),
  );
}
