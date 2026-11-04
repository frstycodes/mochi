# hover-card

2026-11-04, golden-pair merge (radix-nova -> base-nova, primitive renamed to PreviewCard; public names stay HoverCard*). Migrated; delays moved Root -> Trigger at every call site.

## Changed

- `apps/desktop/src/components/ui/hover-card.tsx`: import `@base-ui/react/preview-card`; Portal > Positioner (`isolate z-50`) > Popup. `align`/`alignOffset`/`side`/`sideOffset`/`collisionPadding` are declared, destructured and forwarded to the Positioner (`collisionPadding` added because `RefHoverCard` passes it). `origin-(--radix-hover-card-content-transform-origin)` -> `origin-(--transform-origin)`. The user's `animate-pop rounded-xl shadow-overlay` is kept. Defaults follow the golden: `side="bottom" sideOffset=4 align="center" alignOffset=4`.
- `openDelay`/`closeDelay` on Root -> `delay`/`closeDelay` on Trigger: `src/ThreadMinimap.tsx`, `src/layout/ThreadPeek.tsx`, `src/chat/RefHoverCard.tsx` (x2), `src/design/sections/overlays.tsx`, and in vendored ai-elements: `context.tsx` (`Context` now takes `openDelay`/`closeDelay` and hands them to `ContextTrigger` through its context, so `ContextRing.tsx`'s `openDelay={150} closeDelay={100}` keeps working), `attachments.tsx` and `prompt-input.tsx` (`*HoverCard` no longer injects 0ms delays; `*HoverCardTrigger` now defaults `delay=0 closeDelay=0`).
- `asChild` -> `render`: `ThreadMinimap`, `ThreadPeek` (`render={children}`, `children` narrowed `ReactNode` -> `ReactElement`), `RefHoverCard` (x2), `ai-elements/context.tsx` (`render={isValidElement(children) ? children : <Button/>}`), design overlays.
- `ThreadPeek.tsx`: the old `onFocus` + `e.preventDefault()` no longer blocks Base UI's handler (Base UI merges handlers and only `preventBaseUIHandler()` stops them). It is replaced by an `onOpenChange` guard that ignores `reason === 'trigger-focus'` unless the target `:focus-visible`. Comment updated to drop the Radix reference.
- `RefHoverCard.tsx`: `OpenControl` was `Pick<ComponentProps<typeof HoverCard>, 'open' | 'onOpenChange'>`, which now carries PreviewCard event details and no longer fits the Popover branch. It is now `{ open?: boolean; onOpenChange?: (open: boolean) => void }`.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" hover-card.tsx` is empty.
- Typecheck: no errors in hover-card.tsx or the consumers above.

## Left alone

- `src/index.css:540` (window-drag `app-no-drag` list): it matched hover cards via `[data-radix-popper-content-wrapper]`. Base UI preview-card popups have no role (checked `preview-card/popup/PreviewCardPopup.js`), so a hover card over a window-drag region is no longer exempt. The rule is shared with menus/select, so I left it for the radix-removal pass.

## Behavior changes

- `alignOffset` now defaults to 4 (golden) instead of 0: center-aligned cards sit 4px off. ThreadPeek and RefHoverCard pass `align` without `alignOffset`, so they get the 4px too.
- Default open delay is 600ms in Base UI (Radix: 700ms). Every app call site sets its own delay, so nothing changes in the app.
- ThreadPeek focus guard: now decided in `onOpenChange` by reason. Pointer-focus (click, window refocus) still should not open it. Not verified at runtime.

## Verify by hand

- Sidebar: hover a thread row for 700ms. The peek opens to the right and closes 150ms after you leave. Click the row: the peek closes and stays shut until the pointer leaves. Tab onto a row: the peek opens. Click the row: it does not open.
- Chat: hover a `#123` PR ref. The card opens after the ref delay and does not stack over the thread peek.
- Thread minimap: hovering ticks shows the prompt card after 150ms.
- Composer context ring: hover opens after 150ms, click pins it open.
