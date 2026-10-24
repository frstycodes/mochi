import { listenKeydown, isCommand } from '../keymap';
import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, Pen, Redo, Stop, TextTool, Undo } from '@/icons';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Thread } from '@/model';
import { BoundShortcut } from '../Shortcut';
import { TooltipIconButton } from '../ui';
import { sendAnnotated } from './actions';
import { ANNOTATION_COLORS, EMPTY_HISTORY, history, isTooSmall, shapePath, type AnnotationTool, type Point, type Shape } from './annotations';
import { updatePage } from './pages';

const TOOLS = [
  { id: 'pen', label: 'Pen', icon: Pen },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'box', label: 'Box', icon: Stop },
  { id: 'note', label: 'Note', icon: TextTool },
] satisfies { id: AnnotationTool; label: string; icon: unknown }[];

// On-screen sizes in CSS px; shapes store them in image px so they look the same at any zoom.
const STROKE = 3;
const NOTE_SIZE = 15;

/** Draw on a capture, then attach it to the composer. Esc cancels, mod+Z / mod+shift+Z undo and redo. */
export function Annotator({ thread, pageId, image, name }: { thread: Thread; pageId: string; image: string; name: string }) {
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].token);
  const [{ past, present, future }, dispatch] = useReducer(history, EMPTY_HISTORY);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [note, setNote] = useState<{ at: Point; text: string } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [isSending, setSending] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Image px per CSS px of the drawing as it's shown now.
  const scale = () => (natural && svgRef.current ? natural.w / svgRef.current.getBoundingClientRect().width : 1);
  const toImage = (e: PointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * natural!.w) / r.width, y: ((e.clientY - r.top) * natural!.h) / r.height };
  };
  const cancel = () => updatePage(pageId, { annotating: null });
  const commitNote = () => {
    if (note) add({ kind: 'note', color, size: NOTE_SIZE * scale(), at: note.at, text: note.text });
    setNote(null);
  };
  const add = (shape: Shape) => !isTooSmall(shape, scale()) && dispatch({ type: 'add', shape });

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!natural || e.button !== 0) return;
    // Otherwise the mousedown that follows moves focus to the editor root and blurs a note input that just mounted.
    e.preventDefault();
    const at = toImage(e);
    if (tool === 'note') {
      commitNote();
      setNote({ at, text: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const size = STROKE * scale();
    setDraft(tool === 'pen' ? { kind: 'pen', color, size, points: [at] } : { kind: tool, color, size, from: at, to: at });
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!draft) return;
    const at = toImage(e);
    setDraft(draft.kind === 'pen' ? { ...draft, points: [...draft.points, at] } : draft.kind === 'note' ? draft : { ...draft, to: at });
  };
  const onPointerUp = () => {
    if (draft) add(draft);
    setDraft(null);
  };

  // On window: the screenshot menu hands focus back to its trigger. Typing in another field (the composer) keeps its own keys.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable=true]')) return;
      if (isCommand(e, 'dismiss')) return updatePage(pageId, { annotating: null });
      const isRedo = isCommand(e, 'annotation-redo');
      if (!isRedo && !isCommand(e, 'annotation-undo')) return;
      e.preventDefault();
      dispatch({ type: isRedo ? 'redo' : 'undo' });
    };
    return listenKeydown(onKeyDown);
  }, [pageId]);

  const send = async () => {
    if (!natural || !svgRef.current) return;
    setSending(true);
    try {
      await sendAnnotated(pageId, thread, await renderPng(svgRef.current, image, natural), name, present.length > 0);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="toolbar" aria-label="Annotate screenshot" className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1.5">
        <ToggleGroup type="single" size="sm" value={tool} onValueChange={(v) => v && setTool(v as AnnotationTool)} aria-label="Tool">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                {/* The tooltip trigger takes over data-state, so the pressed look keys off aria-checked. */}
                <ToggleGroupItem value={id} aria-label={label} className="size-7 text-muted-foreground aria-checked:bg-accent aria-checked:text-foreground">
                  <Icon className="size-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
        <div role="radiogroup" aria-label="Colour" className="ml-1.5 flex items-center gap-1">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c.token}
              type="button"
              role="radio"
              aria-checked={color === c.token}
              aria-label={c.name}
              title={c.name}
              onClick={() => setColor(c.token)}
              className="flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn('size-3.5 rounded-full ring-offset-2 ring-offset-sidebar', color === c.token && 'ring-2 ring-foreground/60')} style={{ background: `var(${c.token})` }} />
            </button>
          ))}
        </div>
        <TooltipIconButton label="Undo" hint={<BoundShortcut command="annotation-undo" />} disabled={!past.length} onClick={() => dispatch({ type: 'undo' })}>
          <Undo />
        </TooltipIconButton>
        <TooltipIconButton label="Redo" hint={<BoundShortcut command="annotation-redo" />} disabled={!future.length} onClick={() => dispatch({ type: 'redo' })}>
          <Redo />
        </TooltipIconButton>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={cancel}>
            Cancel
          </Button>
          <Button size="sm" className="rounded-full" disabled={!natural || isSending} onClick={send}>
            Add to composer
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
        <div className="relative mx-auto w-full" style={natural ? { maxWidth: natural.w / devicePixelRatio } : undefined}>
          <img src={image} alt="Screenshot to annotate" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="block w-full rounded-md outline outline-1 -outline-offset-1 outline-black/8 select-none dark:outline-white/8" />
          {!!natural && (
            <svg
              ref={svgRef}
              data-no-orbit
              viewBox={`0 0 ${natural.w} ${natural.h}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDraft(null)}
              className={cn('absolute inset-0 size-full touch-none', tool === 'note' ? 'cursor-text' : 'cursor-crosshair')}
            >
              {[...present, ...(draft ? [draft] : [])].map((shape, i) => (
                <ShapeMark key={i} shape={shape} />
              ))}
            </svg>
          )}
          {!!note && !!natural && (
            <input
              autoFocus
              aria-label="Note"
              placeholder="Note"
              value={note.text}
              onChange={(e) => setNote({ ...note, text: e.target.value })}
              onBlur={commitNote}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitNote();
                if (e.key === 'Escape') setNote(null);
              }}
              className="absolute h-6 min-w-24 rounded-sm border border-dashed border-current bg-transparent px-0.5 font-semibold outline-none"
              style={{ left: note.at.x / scale(), top: note.at.y / scale() - 18, fontSize: NOTE_SIZE, color: `var(${color})`, width: `${Math.max(note.text.length + 2, 8)}ch` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ShapeMark({ shape }: { shape: Shape }) {
  const stroke = `var(${shape.color})`;
  if (shape.kind === 'note')
    return (
      <text x={shape.at.x} y={shape.at.y} fontSize={shape.size} fontWeight={600} fill={stroke}>
        {shape.text}
      </text>
    );
  return <path d={shapePath(shape)} fill="none" stroke={stroke} strokeWidth={shape.size} strokeLinecap="round" strokeLinejoin="round" />;
}

/** The capture with the marks drawn over it, at the capture's own resolution. */
async function renderPng(svg: SVGSVGElement, image: string, natural: { w: number; h: number }) {
  const canvas = document.createElement('canvas');
  canvas.width = natural.w;
  canvas.height = natural.h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(await loadImage(image), 0, 0);
  // An SVG drawn as an image can't see the page's CSS, so token colours and the font are written onto the copy.
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const live = svg.querySelectorAll('path, text');
  copy.querySelectorAll('path, text').forEach((el, i) => {
    const style = getComputedStyle(live[i]);
    el.setAttribute('stroke', style.stroke);
    el.setAttribute('fill', style.fill);
    el.setAttribute('font-family', style.fontFamily);
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(natural.w));
  copy.setAttribute('height', String(natural.h));
  ctx.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`), 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG'))), 'image/png'));
}

async function loadImage(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
