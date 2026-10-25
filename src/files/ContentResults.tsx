import { FileIcon } from '@react-symbols/icons/utils';
import type { SearchHits, SearchLine } from '@/host/types/fs';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/format';
import type { FileTarget } from './FileFinder';
import { Highlighted } from './Highlighted';
import type { useContentSearch } from './useContentSearch';

/** Every hit line in display order, the index keyboard navigation moves through. */
export function contentHits(files: SearchHits[]) {
  return files.flatMap(({ path, lines }) =>
    lines.map((line) => ({ path, line })),
  );
}

const numbers = new Intl.NumberFormat('en');

export function ContentResults({
  search,
  hits,
  active,
  onOpen,
}: {
  search: ReturnType<typeof useContentSearch>;
  hits: ReturnType<typeof contentHits>;
  active: number;
  onOpen: (target: FileTarget) => void;
}) {
  if (search.status === 'idle') return <SearchHint />;
  if (search.status === 'error')
    return <p className="px-3 type-caption text-destructive">{search.error}</p>;
  const isEmpty = search.status !== 'searching' && hits.length === 0;
  let index = 0;
  return (
    <div className="flex flex-col pb-2">
      <p role="status" className="px-3 pb-1 type-caption text-muted-foreground">
        {isEmpty ? 'No results' : summary(hits.length, search.files.length)}
        {search.status === 'searching' && ' · Searching…'}
        {search.status === 'truncated' && ' · Showing the first results only'}
      </p>
      <ul aria-label="Search results" className="flex flex-col gap-0.5 px-1.5">
        {search.files.map((file) => (
          <li key={file.path}>
            <FileHeader
              path={file.path}
              hitCount={file.lines.length}
              onOpen={() => onOpen({ path: file.path })}
            />
            <ul>
              {file.lines.map((line) => {
                const at = index++;
                return (
                  <HitRow
                    key={line.line}
                    hitKey={`hit:${at}`}
                    line={line}
                    isActive={at === active}
                    onOpen={() =>
                      onOpen({
                        path: file.path,
                        line: line.line,
                        column: line.column,
                      })
                    }
                  />
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function summary(results: number, files: number) {
  return `${counted(results, 'result')} in ${counted(files, 'file')}`;
}

function counted(n: number, noun: string) {
  return `${numbers.format(n)} ${plural(n, noun, `${noun}s`)}`;
}

function SearchHint() {
  return (
    <p className="px-3 type-caption text-muted-foreground">
      Type after the ? to search inside every file.
    </p>
  );
}

function FileHeader({
  path,
  hitCount,
  onOpen,
}: {
  path: string;
  hitCount: number;
  onOpen: () => void;
}) {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onOpen}
      title={path}
      className="flex h-6.5 w-full items-center gap-1.5 rounded-md px-1 text-left type-meta outline-none hover:bg-sidebar-accent/60"
    >
      <FileIcon
        fileName={name}
        autoAssign
        aria-hidden
        className="size-3.5 shrink-0"
      />
      <span className="shrink-0 text-foreground">{name}</span>
      <span className="min-w-0 flex-1 truncate type-caption text-subtle-foreground">
        {path.slice(0, slash)}
      </span>
      <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
        {hitCount}
      </span>
    </button>
  );
}

function HitRow({
  hitKey,
  line,
  isActive,
  onOpen,
}: {
  hitKey: string;
  line: SearchLine;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <li data-key={hitKey}>
      <button
        type="button"
        tabIndex={-1}
        onClick={onOpen}
        className={cn(
          'flex h-6 w-full items-center gap-2 rounded-md pr-2 pl-1 text-left text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground',
          isActive &&
            'bg-sidebar-accent text-foreground hover:bg-sidebar-accent',
        )}
      >
        <span className="w-8 shrink-0 text-right type-caption text-subtle-foreground tabular-nums">
          {line.line}
        </span>
        <Highlighted
          text={`${line.isCut ? '…' : ''}${line.text}`}
          ranges={
            line.isCut
              ? line.ranges.map(([from, to]) => [from + 1, to + 1])
              : line.ranges
          }
          className="min-w-0 truncate font-mono type-caption whitespace-pre"
          markClassName="rounded-sm bg-warning/25 text-foreground"
        />
      </button>
    </li>
  );
}
