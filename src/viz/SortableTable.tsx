import { Children, cloneElement, isValidElement, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { defaultComponents, type ExtraProps } from 'streamdown';
import { ArrowDown, ArrowUp, SortV } from 'reicon-react';
import { compareCells, nextSort, type SortDir } from './cells';

type HastElement = NonNullable<ExtraProps['node']>;
type HastNode = HastElement['children'][number];
type Part = ReactElement<{ children?: ReactNode } & ExtraProps>;

/**
 * Streamdown's table (copy as CSV / Markdown / TSV, download, fullscreen) with sortable columns.
 * Rows are reordered as rendered elements, so inline code and links in cells survive sorting.
 */
export function SortableTable({ children, ...props }: ComponentProps<'table'> & ExtraProps) {
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null);
  const DefaultTable = defaultComponents.table;
  const sections = parts(children).map((section) => {
    const tag = section.props.node?.tagName;
    if (tag === 'thead') return cloneElement(section, { children: parts(section.props.children).map((row) => cloneElement(row, { children: parts(row.props.children).map((th, col) => header(th, col)) })) });
    if (tag === 'tbody' && sort) return cloneElement(section, { children: sortRows(parts(section.props.children), sort) });
    return section;
  });

  function header(th: Part, col: number) {
    const dir = sort?.col === col ? sort.dir : null;
    const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : SortV;
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

  return <DefaultTable {...props}>{sections}</DefaultTable>;
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
