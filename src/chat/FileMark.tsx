import { FileIcon } from '@react-symbols/icons/utils';
import { Folder } from '@/icons';
import { cn } from '@/lib/utils';

/** A file's type icon, or a folder: the `@` menu row, the composer token and the sent link share it. */
export function FileMark({ name, isDir = false, className }: { name: string; isDir?: boolean; className?: string }) {
  if (isDir) return <Folder className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden />;
  return <FileIcon fileName={name} autoAssign aria-hidden className={cn('size-4 shrink-0', className)} />;
}
