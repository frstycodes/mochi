import { Skeleton } from '@/components/ui/skeleton';
import { SettingsRow } from '@/settings/parts';
import { cn } from '@/lib/utils';

/** Placeholder rows shaped like the list they stand in for: a settings row, a changed file with its stat, or a plain file row. */
export function SkeletonRows({
  count,
  shape = 'setting',
  label = 'Loading',
  className,
}: {
  count: number;
  shape?: 'setting' | 'change' | 'file';
  label?: string;
  className?: string;
}) {
  // No wrapper here: SettingsCard rounds and divides its rows by sibling position.
  if (shape === 'setting') return <SettingRows count={count} />;
  return (
    <div
      aria-busy
      aria-label={label}
      className={cn('flex flex-col gap-0.5', className)}
    >
      {Array.from({ length: count }, (_, i) =>
        shape === 'change' ? (
          <ChangeRow key={i} width={CHANGE_WIDTHS[i % CHANGE_WIDTHS.length]} />
        ) : (
          <FileRow key={i} width={FILE_WIDTHS[i % FILE_WIDTHS.length]} />
        ),
      )}
    </div>
  );
}

const SETTING_WIDTHS = ['w-40', 'w-28', 'w-48', 'w-32'];
const CHANGE_WIDTHS = ['w-[52%]', 'w-[38%]', 'w-[64%]', 'w-[44%]'];
const FILE_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3'];

function SettingRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <SettingsRow
      key={i}
      label={
        <span className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton
            className={cn('h-3', SETTING_WIDTHS[i % SETTING_WIDTHS.length])}
          />
        </span>
      }
    />
  ));
}

function ChangeRow({ width }: { width: string }) {
  return (
    <div className="flex h-7 items-center gap-1.5 px-1.5">
      <Skeleton className="size-3.5" />
      <Skeleton className={cn('h-2.5', width)} />
      <Skeleton className="ml-auto h-2.5 w-10" />
    </div>
  );
}

function FileRow({ width }: { width: string }) {
  return (
    <div className="flex h-7 items-center gap-2 px-2">
      <Skeleton className="size-4 rounded-sm" />
      <Skeleton className={cn('h-2.5', width)} />
    </div>
  );
}
