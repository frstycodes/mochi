import type { ComponentProps } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import type { ExtraProps } from 'streamdown';
import { cn } from '@/lib/utils';
import { isFilePath } from './kinds';
import { openFromScope, useThreadFiles } from './viewer';

const INLINE_CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-sm';

/** Streamdown's inline code, except a file path in a thread with a folder becomes a chip that opens the file viewer. */
export function FileCode({ node: _node, className, children, ...props }: ComponentProps<'code'> & ExtraProps) {
  const base = useThreadFiles();
  if (!base || typeof children !== 'string' || !isFilePath(children))
    return (
      <code data-streamdown="inline-code" className={cn(INLINE_CODE, className)} {...props}>
        {children}
      </code>
    );
  return (
    <button
      type="button"
      data-file-link={children}
      onClick={(e) => openFromScope(e.currentTarget, base)}
      className={cn(INLINE_CODE, 'inline-flex max-w-full cursor-pointer items-center gap-1 align-bottom transition-colors hover:bg-accent')}
    >
      <FileIcon fileName={children.split('/').pop()!.replace(/(?::\d+)+$/, '')} autoAssign aria-hidden className="size-3.5 shrink-0" />
      <code className="truncate">{children}</code>
    </button>
  );
}
