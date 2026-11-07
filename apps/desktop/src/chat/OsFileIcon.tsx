import { useQuery } from '@tanstack/react-query';
import { File } from '@/icons';
import { cn } from '@/lib/utils';
import { host } from '../host';
import { queryKeys } from '../queryKeys';

/** The icon Finder (Explorer) shows for a file named `name`, asked once per extension; the generic file icon where the OS gives none. */
export function OsFileIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const extension = name.includes('.')
    ? name.split('.').pop()!.toLowerCase()
    : '';
  const iconQuery = useQuery({
    queryKey: queryKeys.chat.fileIcon(extension),
    queryFn: () => host.fs.fileIcon(name).catch(() => null),
    staleTime: Infinity,
  });
  if (iconQuery.isPending)
    return <span aria-hidden className={cn('shrink-0', className)} />;
  if (!iconQuery.data)
    return (
      <File
        aria-hidden
        className={cn('shrink-0 text-muted-foreground', className)}
      />
    );
  return (
    <img
      src={iconQuery.data}
      alt=""
      draggable={false}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
