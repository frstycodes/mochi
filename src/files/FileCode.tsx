import type { ComponentProps } from 'react';
import type { ExtraProps } from 'streamdown';
import { cn } from '@/lib/utils';
import { FileLinkButton, useWorktreeLink } from '../chat/ChatLink';
import { isFilePath } from './kinds';

const INLINE_CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-sm';

/** Streamdown's inline code, except a path to a file in the thread's folder becomes a chip that opens the file viewer. */
export function FileCode({ node: _node, className, children, ...props }: ComponentProps<'code'> & ExtraProps) {
  const text = typeof children === 'string' && isFilePath(children) ? children : '';
  const link = useWorktreeLink(text);
  if (!link)
    return (
      <code data-streamdown="inline-code" className={cn(INLINE_CODE, className)} {...props}>
        {children}
      </code>
    );
  return (
    <FileLinkButton link={link} className={cn(INLINE_CODE, 'items-center align-bottom transition-colors hover:bg-accent')}>
      <code className="truncate">{children}</code>
    </FileLinkButton>
  );
}
