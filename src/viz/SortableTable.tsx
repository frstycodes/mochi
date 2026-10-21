import { Children, cloneElement, isValidElement, useRef, useState, type ComponentProps, type ReactElement, type ReactNode, type RefObject } from 'react';
import { extractTableDataFromElement, tableDataToCSV, tableDataToMarkdown, tableDataToTSV, type ExtraProps } from 'streamdown';
import { toast } from '@/toast/store';
import { ArrowDown, ArrowUp, Download, Maximize, SortVertical, Table } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TooltipIconButton } from '../ui';
import { compareCells, nextSort, type SortDir } from './cells';
import { EmbedFrame } from './EmbedFrame';
import { download } from './exportVisual';
import { CopyIcon, FullscreenDialog, useCopy } from './VisualFrame';

type HastElement = NonNullable<ExtraProps['node']>;
type HastNode = HastElement['children'][number];
type Part = ReactElement<{ children?: ReactNode } & ExtraProps>;

/**
 * A markdown table in the embed frame, with sortable columns and copy (CSV / TSV / Markdown), download and fullscreen in the caption row.
 * Rows are reordered as rendered elements, so inline code and links in cells survive sorting.
 */
export function SortableTable({ children, className, node: _node, ...props }: ComponentProps<'table'> & ExtraProps) {
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null);
  const [isFullscreen, setFullscreen] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const sections = parts(children).map((section) => {
    const tag = section.props.node?.tagName;
    if (tag === 'thead') return cloneElement(section, { children: parts(section.props.children).map((row) => cloneElement(row, { children: parts(row.props.children).map((th, col) => header(th, col)) })) });
    if (tag === 'tbody' && sort) return cloneElement(section, { children: sortRows(parts(section.props.children), sort) });
    return section;
  });

  function header(th: Part, col: number) {
    const dir = sort?.col === col ? sort.dir : null;
    const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : SortVertical;
    return cloneElement(th, {
      'aria-sort': dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none',
      children: (
        <button type="button" onClick={() => setSort(nextSort(sort, col))} className="group/sort -mx-1 inline-flex cursor-default items-center gap-1 rounded-sm px-1 text-left hover:text-foreground">
          {th.props.children}
          <Icon aria-hidden className={dir ? 'size-3.5 text-foreground' : 'size-3.5 text-subtle-foreground opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100'} />
        </button>
      ),
    } as Partial<Part['props']>);
  }

  const table = (
    <table className={cn('w-full divide-y divide-border', className)} data-streamdown="table" {...props}>
      {sections}
    </table>
  );
  return (
    <>
      <EmbedFrame ref={frame} icon={Table} title="Table" className="my-3" actions={<TableActions frame={frame} onFullscreen={() => setFullscreen(true)} />}>
        <div className="overflow-x-auto">{table}</div>
      </EmbedFrame>
      <FullscreenDialog title="Table" isOpen={isFullscreen} onOpenChange={setFullscreen}>
        {table}
      </FullscreenDialog>
    </>
  );
}

const FORMATS = {
  csv: { label: 'CSV', ext: 'csv', type: 'text/csv', serialize: tableDataToCSV },
  tsv: { label: 'TSV', ext: 'tsv', type: 'text/tab-separated-values', serialize: tableDataToTSV },
  md: { label: 'Markdown', ext: 'md', type: 'text/markdown', serialize: tableDataToMarkdown },
};

type Format = keyof typeof FORMATS;

const COPY_FORMATS: Format[] = ['md', 'csv', 'tsv'];
const DOWNLOAD_FORMATS: Format[] = ['csv', 'md'];

function TableActions({ frame, onFullscreen }: { frame: RefObject<HTMLElement | null>; onFullscreen: () => void }) {
  const { isCopied, copy } = useCopy();
  const serialize = (format: Format) => {
    const el = frame.current?.querySelector('table');
    if (!el) throw new Error('Table not found');
    return FORMATS[format].serialize(extractTableDataFromElement(el));
  };
  const run = (action: () => unknown) => () => {
    try {
      action();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <FormatMenu label={isCopied ? 'Copied' : 'Copy table'} icon={<CopyIcon isCopied={isCopied} />} formats={COPY_FORMATS} onPick={(f) => run(() => copy(serialize(f)))} />
      <FormatMenu label="Download" icon={<Download />} formats={DOWNLOAD_FORMATS} onPick={(f) => run(() => download(`table.${FORMATS[f].ext}`, serialize(f), FORMATS[f].type))} />
      <TooltipIconButton label="Fullscreen" onClick={onFullscreen}>
        <Maximize />
      </TooltipIconButton>
    </>
  );
}

function FormatMenu({ label, icon, formats, onPick }: { label: string; icon: ReactNode; formats: Format[]; onPick: (format: Format) => () => void }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label}>
              {icon}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        {formats.map((f) => (
          <DropdownMenuItem key={f} onSelect={onPick(f)}>
            {FORMATS[f].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function parts(children: ReactNode) {
  return Children.toArray(children).filter((c): c is Part => isValidElement(c));
}

function sortRows(rows: Part[], { col, dir }: { col: number; dir: SortDir }) {
  const keyed = rows.map((row) => ({ row, key: cellText(row.props.node, col) }));
  keyed.sort((a, b) => (dir === 'asc' ? 1 : -1) * compareCells(a.key, b.key));
  return keyed.map((k) => k.row);
}

function cellText(row: HastElement | undefined, col: number) {
  const cell = row?.children.filter((c): c is HastElement => c.type === 'element')[col];
  return cell ? text(cell) : '';
}

function text(node: HastNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(text).join('');
  return '';
}
