import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { defaultComponents, type ExtraProps } from 'streamdown';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { copyText } from '../clipboard';
import { worktreeLink } from '../files/kinds';
import { useWorktreeFiles } from '../files/useWorktreeFiles';
import { useThreadFiles } from '../files/viewer';
import { fileLink } from '../terminal/links';
import { useGithubScope } from '../git/useThreadPrs';
import { useHarness, useThread } from '../store';
import { useVizThreadId } from '../viz/WidgetVisual';
import { RefHoverCard, RefIcon } from './RefHoverCard';
import { refDescription, refFromUrl, refLabel, refTone, refUrl, type GithubRef } from './refs';
import { REF_CHIP_CLASS } from '@/icons/github';
import { useRefState, useRepoSlug } from './useRefState';

const DefaultLink = defaultComponents.a!;

type LinkProps = ComponentProps<'a'> & ExtraProps & { 'data-ref'?: string; 'data-path'?: string };

/**
 * Streamdown's link, except GitHub PRs and issues become state chips and paths to files in the thread's folder open the viewer.
 * `data-ref` / `data-path` come from `rehypeRefs` (refs and paths in prose); URLs and markdown links arrive as plain `href`s.
 */
export function ChatLink(props: LinkProps) {
  const { href = '', children, 'data-ref': textRef, 'data-path': textPath } = props;
  if (textRef !== undefined) return <TextRef refKey={textRef}>{children}</TextRef>;
  const urlRef = refFromUrl(href);
  // An autolinked URL shows as the compact label; a named link keeps its words.
  if (urlRef) return <RefChip githubRef={urlRef}>{textOf(children) === href ? undefined : children}</RefChip>;
  if (textPath !== undefined || isRelative(href)) return <PathLink path={href}>{children}</PathLink>;
  return <DefaultLink {...props} />;
}

/** `owner/repo#n` or `#n` from prose; an empty owner is the thread's own repo, so `#n` stays text in a thread without one. */
function TextRef({ refKey, children }: { refKey: string; children: ReactNode }) {
  const { cwd } = useThreadGithub();
  const home = useRepoSlug(cwd);
  const [, owner, repo, number] = refKey.match(/^([^/]*)\/([^#]*)#(\d+)$/)!;
  if (!owner && !home) return children;
  return <RefChip githubRef={owner ? { owner, repo, number: Number(number) } : { ...home!, number: Number(number) }} />;
}

/** A PR or issue: its state icon in the state's colour, `#n` (own repo) or `owner/repo#n`, the preview card on hover or focus. */
export function RefChip({ githubRef, children }: { githubRef: GithubRef; children?: ReactNode }) {
  const { threadId, cwd, githubUser } = useThreadGithub();
  const home = useRepoSlug(cwd);
  const state = useRefState(githubRef, { cwd, githubUser });
  const { dispatch } = useHarness();
  const url = state?.url ?? refUrl(githubRef);
  const description = refDescription(githubRef.kind, state);
  const label = refLabel(githubRef, home);

  return (
    <ContextMenu>
      <RefHoverCard item={{ githubRef, label, state }}>
        <ContextMenuTrigger asChild>
          <a
            href={url}
            onClick={(e) => {
              e.preventDefault();
              dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url });
            }}
            aria-label={`${children ? textOf(children) : label}: ${state?.title ? `${state.title}, ` : ''}${description}`}
            className={cn('inline-flex max-w-full items-center gap-[0.3em] rounded-md px-[0.4em] align-baseline text-[0.9em] leading-snug font-medium no-underline transition-colors', REF_CHIP_CLASS[refTone(state)])}
          >
            <RefIcon item={{ githubRef, label, state }} className="size-[1em]" />
            <span className="truncate tabular">{children ?? label}</span>
            {state?.checks === 'fail' && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />}
          </a>
        </ContextMenuTrigger>
      </RefHoverCard>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url })}>Open in the side pane</ContextMenuItem>
        {/* The main process sends a new window's http(s) URL to the system browser (electron/window.ts). */}
        <ContextMenuItem onSelect={() => window.open(url, '_blank', 'noreferrer')}>Open in your browser</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(url, 'Link copied')}>Copy link</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A path that exists in the thread's folder opens the viewer at its line; anything else stays plain text. */
function PathLink({ path, children }: { path: string; children: ReactNode }) {
  const link = useWorktreeLink(path);
  if (!link) return children;
  return (
    <FileLinkButton link={link} className="font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
      {children}
    </FileLinkButton>
  );
}

/** The viewer link (`src/a.ts:12`) for `text` when it names a file in the thread's folder, else null. */
export function useWorktreeLink(text: string) {
  const base = useThreadFiles();
  const files = useWorktreeFiles(base?.root ?? null);
  return base && files ? worktreeLink(text, base.root, files) : null;
}

/** Opens `link` (`src/a.ts:12`) in the side pane's Files tab at its line; the file-type icon leads. */
export function FileLinkButton({ link, className, children }: { link: string; className?: string; children: ReactNode }) {
  const threadId = useVizThreadId();
  const { dispatch } = useHarness();
  const file = fileLink(link);
  return (
    <button type="button" data-file-link={link} onClick={() => dispatch({ type: 'pane-open-tab', threadId, kind: 'files', file })} className={cn('inline-flex max-w-full cursor-pointer items-baseline gap-1 text-left align-baseline', className)}>
      <FileIcon fileName={file.path.split('/').pop()!} autoAssign aria-hidden className="size-3.5 shrink-0 self-center" />
      {children}
    </button>
  );
}

function useThreadGithub() {
  const threadId = useVizThreadId();
  return { threadId, ...useGithubScope(useThread(threadId)) };
}

function isRelative(href: string) {
  return !!href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href);
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  // Streamed words arrive wrapped in spans.
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}
