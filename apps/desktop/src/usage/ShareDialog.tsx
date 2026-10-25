import { useRef, useState, type ReactNode } from 'react';
import { toBlob } from 'html-to-image';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Copy, Download } from '@/icons';
import { useSize } from '../browser/PageSurface';
import { download } from '../viz/exportVisual';
import { localDay } from '@mochi/domain/usage/days';
import { rangeStart, type RangeId, type UsageView } from './report';
import { CARD, ShareCard } from './ShareCard';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string };

/** The share card at preview size, with Copy image and Save image; the image is the card at 2×, 2400 × 1350. */
export function ShareDialog({
  isOpen,
  onOpenChange,
  view,
  range,
  projectName,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  view: UsageView;
  range: RangeId;
  projectName: string | null;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const period = periodLabel(view, range);

  const render = async (use: (png: Blob) => Promise<void>, done: string) => {
    if (!cardRef.current) return;
    setStatus({ kind: 'busy' });
    try {
      await chartsDrawn(cardRef.current);
      const png = await toBlob(cardRef.current, {
        pixelRatio: 2,
        width: CARD.width,
        height: CARD.height,
        backgroundColor: getComputedStyle(cardRef.current).backgroundColor,
      });
      if (!png) throw new Error('The image came out empty');
      await use(png);
      setStatus({ kind: 'done', message: done });
    } catch (error) {
      setStatus({
        kind: 'failed',
        message: `Couldn't make the image: ${(error as Error).message}`,
      });
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        setStatus({ kind: 'idle' });
      }}
    >
      <DialogContent className="sm:max-w-[min(1024px,calc(100vw-4rem))]">
        <DialogHeader>
          <DialogTitle>Share your usage</DialogTitle>
          <DialogDescription>
            A 2400 × 1350 picture of {period}
            {projectName ? ` in ${projectName}` : ''}, in the app's current
            theme.
          </DialogDescription>
        </DialogHeader>
        <CardPreview>
          <ShareCard
            ref={cardRef}
            view={view}
            period={period}
            projectName={projectName}
          />
        </CardPreview>
        <DialogFooter className="items-center">
          {status.kind === 'done' && (
            <span
              className="type-meta mr-auto text-muted-foreground"
              role="status"
            >
              {status.message}
            </span>
          )}
          {status.kind === 'failed' && (
            <span className="type-meta mr-auto text-destructive" role="alert">
              {status.message}
            </span>
          )}
          <Button
            variant="outline"
            disabled={status.kind === 'busy'}
            onClick={() =>
              render(
                (png) =>
                  navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': png }),
                  ]),
                'Copied the image',
              )
            }
          >
            <Copy data-icon="inline-start" />
            Copy image
          </Button>
          <Button
            disabled={status.kind === 'busy'}
            onClick={() =>
              render(
                async (png) =>
                  download(`mochi-usage-${localDay(Date.now())}.png`, png),
                'Saved to your Downloads folder',
              )
            }
          >
            <Download data-icon="inline-start" />
            Save image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Charts size themselves a frame after mounting; an export taken before that would leave their boxes empty. */
async function chartsDrawn(card: HTMLElement) {
  for (
    let frame = 0;
    frame < 60 && card.querySelector('[data-chart="measuring"]');
    frame++
  )
    await new Promise(requestAnimationFrame);
}

/** The full-size card scaled to the dialog's width; the export reads the unscaled card inside it. */
function CardPreview({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { w } = useSize(frameRef);
  const scale = w / CARD.width;
  return (
    <div
      ref={frameRef}
      className="relative aspect-[16/9] w-full overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--color-border)]"
    >
      {w > 0 && (
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `scale(${scale})` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** "Oct 11 – 17, 2026", or "Sep 20 – Oct 19, 2026" across months; all time starts at the first active day. */
function periodLabel(view: UsageView, range: RangeId) {
  const first =
    range === 'all'
      ? new Date(`${view.series[0]?.key ?? localDay(Date.now())}T12:00:00`)
      : new Date(rangeStart(range, Date.now())!);
  const last = new Date();
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  const sameYear = first.getFullYear() === last.getFullYear();
  const start = `${month(first)} ${first.getDate()}${sameYear ? '' : `, ${first.getFullYear()}`}`;
  const end =
    first.getMonth() === last.getMonth() && sameYear
      ? `${last.getDate()}`
      : `${month(last)} ${last.getDate()}`;
  return `${start} – ${end}, ${last.getFullYear()}`;
}
