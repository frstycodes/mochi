import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, DocumentText } from 'reicon-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { parseCsv, type PreviewKind } from './kinds';

/** Previews a file's content; text kinds (svg, markdown, json, csv) get the current draft so edits show up live. */
export function FilePreview({ kind, path, data }: { kind: PreviewKind; path: string; data: string | Uint8Array }) {
  if (kind === 'markdown') return <MarkdownPreview text={String(data)} />;
  if (kind === 'json') return <JsonPreview text={String(data)} />;
  if (kind === 'csv') return <CsvPreview text={String(data)} delimiter={/\.tsv$/i.test(path) ? '\t' : ','} />;
  if (kind === 'pdf') return <PdfPreview data={data} />;
  return <ImagePreview data={data} type={kind === 'svg' ? 'image/svg+xml' : imageMime(path)} name={path} />;
}

// An <img> never runs an SVG's scripts, so untrusted SVGs are safe to show this way.
function ImagePreview({ data, type, name }: { data: string | Uint8Array; type: string; name: string }) {
  const url = useObjectUrl(data, type);
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      {!!url && <img src={url} alt={name} className="max-h-full max-w-full object-contain" />}
    </div>
  );
}

// Chromium's built-in PDF viewer renders a blob: URL in the desktop app; on the web only browsers that ship a viewer can.
function PdfPreview({ data }: { data: string | Uint8Array }) {
  const url = useObjectUrl(data, 'application/pdf');
  if (!host.isDesktop && !navigator.pdfViewerEnabled) return <NoPdfViewerState />;
  return !!url && <iframe src={url} title="PDF preview" className="size-full border-0" />;
}

function NoPdfViewerState() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DocumentText />
        </EmptyMedia>
        <EmptyTitle>No PDF viewer here</EmptyTitle>
        <EmptyDescription>This browser can't show PDFs inline. Download the file or open it in the desktop app.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ponytail: renders the first MAX_CSV_ROWS rows, virtualize if people need to scroll past that.
const MAX_CSV_ROWS = 1000;

// A plain <table>, not the shadcn Table: its overflow-x wrapper would become the sticky header's scroll container.
function CsvPreview({ text, delimiter }: { text: string; delimiter: string }) {
  const [head = [], ...rows] = useMemo(() => parseCsv(text, delimiter), [text, delimiter]);
  const shown = rows.slice(0, MAX_CSV_ROWS);
  return (
    <div className="h-full overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 type-meta tabular">
        <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-0">
          <TableRow className="hover:bg-transparent">
            {head.map((cell, i) => (
              <TableHead key={i} className="h-8 px-3 shadow-[inset_0_-1px_0_var(--border)]">
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, r) => (
            <TableRow key={r} className="border-0">
              {row.map((cell, c) => (
                <TableCell key={c} className="max-w-80 truncate px-3 py-1" title={cell.length > 40 ? cell : undefined}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
      {rows.length > MAX_CSV_ROWS && (
        <p className="px-3 py-2 type-caption text-subtle-foreground">
          Showing the first {MAX_CSV_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows
        </p>
      )}
    </div>
  );
}

function MarkdownPreview({ text }: { text: string }) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-180 px-6 py-5 type-prose">
        <MessageResponse>{text}</MessageResponse>
      </div>
    </ScrollArea>
  );
}

function JsonPreview({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(text) as unknown };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [text]);
  if ('error' in parsed) return <p className="p-4 font-mono text-xs text-destructive">{parsed.error}</p>;
  return (
    <ScrollArea className="h-full">
      <div className="p-3 font-mono text-xs leading-5">
        <JsonNode name={null} value={parsed.value} depth={0} />
      </div>
    </ScrollArea>
  );
}

function JsonNode({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const label = name !== null && <span className="text-muted-foreground">{name}: </span>;
  if (value === null || typeof value !== 'object') return <div className="pl-4">{label}<JsonScalar value={value} /></div>;
  const entries = Object.entries(value);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <div>
      <button type="button" onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen} className="flex items-center rounded-sm hover:bg-accent">
        <ChevronRight aria-hidden className={cn('size-3.5 text-subtle-foreground', isOpen && 'rotate-90')} />
        {label}
        <span className="text-subtle-foreground">
          {open}
          {!isOpen && `… ${entries.length} ${close}`}
        </span>
      </button>
      {isOpen && (
        <div className="ml-1.5 border-l pl-1.5">
          {entries.map(([key, child]) => (
            <JsonNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
        </div>
      )}
      {isOpen && <div className="pl-4 text-subtle-foreground">{close}</div>}
    </div>
  );
}

const SCALAR_TONE = { string: 'text-[light-dark(#0a3069,#a5d6ff)]', number: 'text-[light-dark(#0550ae,#79c0ff)]', boolean: 'text-[light-dark(#cf222e,#ff7b72)]' } satisfies Record<string, string>;

function JsonScalar({ value }: { value: unknown }) {
  const tone = SCALAR_TONE[typeof value as keyof typeof SCALAR_TONE] ?? 'text-subtle-foreground';
  return <span className={cn('break-all', tone)}>{JSON.stringify(value)}</span>;
}

function useObjectUrl(data: string | Uint8Array, type: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data, type]);
  return url;
}

export function imageMime(path: string) {
  const ext = path.split('.').pop()!.toLowerCase();
  return ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
}
