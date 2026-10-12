import { useId, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Bug, Camera, Cursor, Danger, Mobile, PhoneRotate, Pip, Refresh, TriangleWarning, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { host } from '@/host';
import type { BrowserCommand, BrowserDevtools } from '@/host/types/browser';
import { cn } from '@/lib/utils';
import type { Thread } from '@/model';
import { useHarness } from '@/store';
import { ProviderMark } from '@/ui';
import { consoleReport, screenshot, togglePick } from './actions';
import { DEVICES, RESPONSIVE } from './devices';
import { deviceSize, isDemoUrl } from './PageSurface';
import { reloadPage, updatePage, useAddressHistory, type Page } from './pages';
import { displayUrl, normalizeUrl } from './url';
import { OverflowIcon } from '../ui';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2];
const DPRS = [0, 1, 2, 3];
const DESKTOP_ONLY = 'Needs the desktop app';

export function BrowserToolbar({ thread, pageId, page, onPopOut }: { thread: Thread; pageId: string; page: Page; onPopOut: () => void }) {
  const isNative = !!page.hostId;
  const canPick = isNative || isDemoUrl(page.url);
  const command = (c: BrowserCommand) => {
    if (c === 'reload' || c === 'hard-reload') reloadPage(pageId, c === 'hard-reload');
    else if (page.hostId) void host.browser.command(page.hostId, c);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-2">
      <IconAction label="Back" disabled={!page.canGoBack} onClick={() => command('back')}>
        <ArrowLeft />
      </IconAction>
      <IconAction label="Forward" disabled={!page.canGoForward} onClick={() => command('forward')}>
        <ArrowRight />
      </IconAction>
      {page.isLoading ? (
        <IconAction label="Stop loading" onClick={() => command('stop')}>
          <X />
        </IconAction>
      ) : (
        <IconAction label="Reload (Shift for hard reload)" onClick={(e) => command(e.shiftKey ? 'hard-reload' : 'reload')}>
          <Refresh />
        </IconAction>
      )}
      <AddressBar pageId={pageId} page={page} />
      {page.console.length > 0 && <ConsoleButton thread={thread} pageId={pageId} page={page} />}
      <IconAction label={canPick ? (page.isPicking ? 'Stop picking' : 'Pick an element to comment on') : DESKTOP_ONLY} pressed={page.isPicking} disabled={!canPick} onClick={() => togglePick(pageId, page, thread)}>
        <Cursor />
      </IconAction>
      <IconAction label={page.device === RESPONSIVE ? 'Emulate a device' : 'Stop emulating'} pressed={page.device !== RESPONSIVE} onClick={() => updatePage(pageId, { device: page.device === RESPONSIVE ? DEVICES[1].id : RESPONSIVE })}>
        <Mobile />
      </IconAction>
      <ScreenshotMenu thread={thread} page={page} />
      <IconAction label="Pop out into a floating window" onClick={onPopOut}>
        <Pip />
      </IconAction>
      <MoreMenu pageId={pageId} page={page} onHardReload={() => command('hard-reload')} />
    </div>
  );
}

function AddressBar({ pageId, page }: { pageId: string; page: Page }) {
  const history = useAddressHistory();
  const listId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (draft === null) return;
    const url = normalizeUrl(draft);
    setDraft(null);
    e.currentTarget.querySelector('input')?.blur();
    updatePage(pageId, { url, error: null });
    if (page.hostId) void host.browser.navigate(page.hostId, url);
  };

  return (
    <form onSubmit={submit} className="mx-1 min-w-0 flex-1">
      <Input
        aria-label="Address"
        list={listId}
        spellCheck={false}
        autoCapitalize="off"
        value={draft ?? displayUrl(page.url)}
        onFocus={(e) => {
          setDraft(page.url);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        className="h-7 truncate rounded-full border-transparent bg-muted px-3 type-caption text-muted-foreground focus-visible:text-foreground dark:bg-muted"
      />
      <datalist id={listId}>
        {history.map((url) => (
          <option key={url} value={url} />
        ))}
      </datalist>
    </form>
  );
}

function ConsoleButton({ thread, pageId, page }: { thread: Thread; pageId: string; page: Page }) {
  const { dispatch } = useHarness();
  const [isOpen, setOpen] = useState(false);
  const errorCount = page.console.filter((c) => c.level === 'error').length;
  const agent = agentName(thread);
  const send = () => {
    dispatch({ type: 'say', threadId: thread.id, entry: { who: 'you', kind: 'message', text: consoleReport(page) } });
    updatePage(pageId, { console: [] });
    setOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`${page.console.length} console messages`} className={cn('h-7 gap-1 rounded-full px-2 tabular-nums', errorCount ? 'text-destructive' : 'text-warning')}>
              <Bug className="size-4" />
              {page.console.length}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Console errors and warnings</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-96 flex-col gap-0 p-0">
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
          <span className="type-title">Console</span>
          <Button variant="ghost" size="xs" onClick={() => updatePage(pageId, { console: [] })}>
            Clear
          </Button>
        </div>
        <ScrollArea type="scroll" className="max-h-72">
          <ul className="flex flex-col gap-0.5 px-1.5">
            {page.console.map((c, i) => (
              <li key={i} className="flex gap-2 rounded-md px-1.5 py-1">
                {c.level === 'error' ? <Danger aria-label="Error" className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : <TriangleWarning aria-label="Warning" className="mt-0.5 size-3.5 shrink-0 text-warning" />}
                <div className="flex min-w-0 flex-col">
                  <span className="line-clamp-3 font-mono type-caption break-all text-foreground">{c.message}</span>
                  {!!c.source && (
                    <span className="truncate font-mono type-caption text-subtle-foreground">
                      {displayUrl(c.source)}:{c.line}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
        <div className="flex justify-end p-2">
          <Button size="sm" onClick={send} className="gap-1.5 rounded-full">
            <ProviderMark provider={thread.providers[0]} size={14} />
            Send to {agent}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScreenshotMenu({ thread, page }: { thread: Thread; page: Page }) {
  const isNative = !!page.hostId;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Screenshot" disabled={!isNative}>
              <Camera />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{isNative ? 'Screenshot into the composer' : DESKTOP_ONLY}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => screenshot(page, thread, false)}>Visible area</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => screenshot(page, thread, true)}>Full page</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreMenu({ pageId, page, onHardReload }: { pageId: string; page: Page; onHardReload: () => void }) {
  const isNative = !!page.hostId;
  const zoomBy = (step: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= page.zoom - 1e-3);
    updatePage(pageId, { zoom: ZOOM_STEPS[Math.min(Math.max(i + step, 0), ZOOM_STEPS.length - 1)] });
  };
  const setDevtools = (mode: string) => {
    updatePage(pageId, { devtools: mode as BrowserDevtools });
    if (page.hostId) void host.browser.devtools(page.hostId, mode as BrowserDevtools);
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <OverflowIcon vertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onHardReload}>
          Hard reload
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!isNative} onSelect={(e) => (e.preventDefault(), zoomBy(1))}>
          Zoom in
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!isNative} onSelect={(e) => (e.preventDefault(), zoomBy(-1))}>
          Zoom out
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!isNative || page.zoom === 1} onSelect={() => updatePage(pageId, { zoom: 1 })}>
          Actual size
          <DropdownMenuShortcut className="tabular-nums">{Math.round(page.zoom * 100)}%</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!isNative}>DevTools</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={page.devtools} onValueChange={setDevtools}>
              <DropdownMenuRadioItem value="docked">Docked below the page</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="detached">In a separate window</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="closed">Closed</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!isNative}>Color scheme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={page.colorScheme ?? 'system'} onValueChange={(v) => updatePage(pageId, { colorScheme: v === 'system' ? null : (v as 'light' | 'dark') })}>
              <DropdownMenuRadioItem value="system">Follow the system</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem disabled={!isNative} checked={page.reducedMotion} onCheckedChange={(on) => updatePage(pageId, { reducedMotion: on })}>
          Reduce motion
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown while device mode is on: Chrome's device toolbar, minus the zoom (that lives in More). */
export function DeviceBar({ pageId, page }: { pageId: string; page: Page }) {
  const size = deviceSize(page) ?? page.custom;
  const setSide = (side: 'width' | 'height', value: number) => {
    if (!Number.isFinite(value) || value < 1) return;
    updatePage(pageId, { device: 'custom', custom: { ...size, [side]: Math.min(value, 4000) } });
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto px-3 type-caption text-muted-foreground" style={{ scrollbarWidth: 'none' }}>
      <Select value={page.device} onValueChange={(device) => updatePage(pageId, { device })}>
        <SelectTrigger size="sm" aria-label="Device" className="shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DEVICES.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>
      <SideInput label="Width" value={page.isRotated ? size.height : size.width} onChange={(v) => setSide(page.isRotated ? 'height' : 'width', v)} />
      <X aria-hidden className="size-3 shrink-0" />
      <SideInput label="Height" value={page.isRotated ? size.width : size.height} onChange={(v) => setSide(page.isRotated ? 'width' : 'height', v)} />
      <IconAction label="Rotate" pressed={page.isRotated} onClick={() => updatePage(pageId, { isRotated: !page.isRotated })}>
        <PhoneRotate />
      </IconAction>
      <Select value={String(page.dpr)} onValueChange={(dpr) => updatePage(pageId, { dpr: Number(dpr) })}>
        <SelectTrigger size="sm" aria-label="Device pixel ratio" className="shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DPRS.map((dpr) => (
            <SelectItem key={dpr} value={String(dpr)}>
              {dpr ? `DPR ${dpr}` : 'DPR auto'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" aria-pressed={page.touch} onClick={() => updatePage(pageId, { touch: !page.touch })} className={cn('h-7 shrink-0 rounded-full', page.touch && 'bg-accent text-foreground')}>
        Touch
      </Button>
    </div>
  );
}

function SideInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Input
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={1}
      max={4000}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-7 w-16 shrink-0 px-2 text-center tabular-nums type-caption [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

/** Agent driving indicator with take-over / give-back. */
export function DriveBar({ thread, pageId, hasTakenOver }: { thread: Thread; pageId: string; hasTakenOver: boolean }) {
  const agent = agentName(thread);
  return (
    <div role="status" className="mx-2 mb-1.5 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-muted/60 pr-1 pl-2.5 type-meta text-muted-foreground">
      <ProviderMark provider={thread.providers[0]} size={14} />
      <span className="min-w-0 flex-1 truncate">{hasTakenOver ? `You have the browser. ${agent} waits until you give it back.` : `${agent} is driving this browser`}</span>
      <Button size="xs" variant={hasTakenOver ? 'default' : 'outline'} className="rounded-full" onClick={() => updatePage(pageId, { hasTakenOver: !hasTakenOver })}>
        {hasTakenOver ? `Give back to ${agent}` : 'Take over'}
      </Button>
    </div>
  );
}

function IconAction({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick?: (e: MouseEvent) => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The span keeps the tooltip working on disabled buttons, which get no pointer events. */}
        <span className="inline-flex shrink-0">
          <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onPointerDown={(e) => e.stopPropagation()} onClick={onClick} className={cn(pressed && 'bg-accent text-foreground')}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function agentName(thread: Thread) {
  return thread.providers[0] === 'codex' ? 'Codex' : 'Claude';
}
