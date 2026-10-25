import type { Project } from '@mochi/domain/host/types/projects';
import { cn } from '@/lib/utils';

/**
 * A project's icon: its favicon or uploaded image, else its first letter on a muted tile. Size it with `className` (size-4
 * in rows); the letter scales with the tile. Decorative: the name is always beside it.
 */
export function ProjectIcon({
  name,
  icon,
  className,
}: {
  name: string;
  icon?: Project['icon'];
  className?: string;
}) {
  if (icon)
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm',
          className,
        )}
      >
        <img
          src={icon.url}
          alt=""
          draggable={false}
          className="size-full object-contain"
        />
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[0.625rem] font-semibold text-foreground uppercase [container-type:size]',
        className,
      )}
    >
      <span className="text-[max(0.625rem,55cqh)] leading-none">
        {name.trim()[0] ?? '?'}
      </span>
    </span>
  );
}
