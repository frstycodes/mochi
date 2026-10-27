import type { ComponentProps } from 'react';
import type { ExtraProps } from 'streamdown';
import { cn } from '@/lib/utils';
import { FileLinkButton, useWorktreeLink } from '../chat/ChatLink';
import { isFilePath } from './kinds';

// em-relative so code sits in whatever text it's in (prose 14px, captions 11px); mono reads larger than the UI font at the same size.
const INLINE_CODE =
  'rounded-md bg-foreground/7 dark:bg-muted px-[0.4em] py-[0.1em] font-mono text-[max(0.85em,11px)]';

/** Streamdown's inline code, except a path to a file in the thread's folder becomes a chip that opens the file viewer. */
export function FileCode({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<'code'> & ExtraProps) {
  const text =
    typeof children === 'string' && isFilePath(children) ? children : '';
  const link = useWorktreeLink(text);
  if (!link)
    return (
      // The smaller mono font with the prose's line-height sits lower and stretches the line; `leading-none` keeps it inside the line's own height.
      <code
        data-streamdown="inline-code"
        className={cn(INLINE_CODE, 'leading-none text-code', className)}
        {...props}
      >
        {children}
      </code>
    );
  return (
    // An inline-flex box counts toward the line's height where inline code's doesn't: `leading-[normal]` sizes it to inline code's box (the font's own ascent + descent) and `-my-[0.1em]` cancels the padding, so the chip never stretches the line.
    <FileLinkButton
      link={link}
      className={cn(
        INLINE_CODE,
        '-my-[0.1em] leading-[normal] transition-colors hover:bg-foreground/11 dark:hover:bg-accent [&>svg]:size-[1.2em]',
      )}
    >
      <code className="truncate">{children}</code>
    </FileLinkButton>
  );
}
