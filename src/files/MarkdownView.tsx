import { lazy, Suspense, useState } from 'react';
import { Code, Eye } from '@/icons';
import { MessageResponse } from '@/components/ai-elements/message';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { splitFrontmatter } from '../library/skillMd';

// Lazy so CodeMirror parses only when someone asks for the source.
const CodeEditor = lazy(() => import('./CodeEditor'));

type Mode = 'rendered' | 'source';

/**
 * A markdown document shown rendered, with its source a toggle away: the toggle sits top right and shows on hover or
 * keyboard focus (always on touch screens). Frontmatter renders as a key/value header instead of a stray rule.
 */
export function MarkdownView({ text, path = 'document.md', className }: { text: string; path?: string; className?: string }) {
  const [mode, setMode] = useState<Mode>('rendered');
  return (
    <div className={cn('group/markdown relative h-full min-h-0', className)}>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={mode}
        onValueChange={(v) => v && setMode(v as Mode)}
        aria-label="Show as"
        className="absolute top-2 right-3 z-10 bg-popover opacity-0 shadow-sm transition-opacity duration-150 group-hover/markdown:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <ToggleGroupItem value="rendered" aria-label="Rendered">
          <Eye />
        </ToggleGroupItem>
        <ToggleGroupItem value="source" aria-label="Source">
          <Code />
        </ToggleGroupItem>
      </ToggleGroup>
      {mode === 'rendered' ? (
        <RenderedMarkdown text={text} />
      ) : (
        <Suspense>
          <CodeEditor readOnly isWrapped path={path} value={text} />
        </Suspense>
      )}
    </div>
  );
}

function RenderedMarkdown({ text }: { text: string }) {
  const { frontmatter, body } = splitFrontmatter(text);
  const fields = Object.entries(frontmatter);
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-180 flex-col gap-4 py-5 pr-24 pl-6">
        {!!fields.length && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b pb-4 type-caption">
            {fields.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-muted-foreground">{key}</dt>
                <dd className="text-pretty text-foreground/90">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="type-prose">
          <MessageResponse>{body}</MessageResponse>
        </div>
      </div>
    </ScrollArea>
  );
}
