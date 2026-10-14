import type { ComponentProps } from 'react';
import type { ExtraProps } from 'streamdown';
import { cn } from '@/lib/utils';
import { FileLinkButton, useWorktreeLink } from '../chat/ChatLink';
import { isFilePath } from './kinds';

// em-relative so code sits in whatever text it's in (prose 14px, captions 11px); mono reads larger than Inter at the same size.
const INLINE_CODE = 'rounded-md bg-muted px-[0.4em] py-[0.1em] font-mono text-[max(0.85em,11px)] shadow-[inset_0_0_0_1px_var(--border)]';

/** Streamdown's inline code, except a path to a file in the thread's folder becomes a chip that opens the file viewer. */
export function FileCode({ node: _node, className, children, ...props }: ComponentProps<'code'> & ExtraProps) {
  const text = typeof children === 'string' && isFilePath(children) ? children : '';
  const link = useWorktreeLink(text);
  if (!link)
    return (
      <code data-streamdown="inline-code" className={cn(INLINE_CODE, 'text-code', className)} {...props}>
        {children}
      </code>
    );
  return (
    <FileLinkButton link={link} className={cn(INLINE_CODE, 'items-center align-bottom transition-colors hover:bg-accent')}>
      <code className="truncate">{children}</code>
    </FileLinkButton>
  );
}
