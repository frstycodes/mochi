# scroll-area

2026-11-04, golden-pair merge (1 conflict resolved by hand). Migrated. User customizations kept: `scroll-fade-y` on the viewport, `p-0.5` scrollbar padding, and the `bg-foreground/20` thumb with its hover tint. The `type="scroll"` + `scrollHideDelay=700` behavior is re-expressed in CSS.

## Changed

- `apps/desktop/src/components/ui/scroll-area.tsx`:
  - imports `@base-ui/react/scroll-area`; `ScrollAreaScrollbar`/`ScrollAreaThumb` -> `Scrollbar`/`Thumb`; props `ScrollAreaPrimitive.Root.Props` / `Scrollbar.Props`
  - removed the `type`/`scrollHideDelay` props
  - scrollbar visibility: `data-[state=hidden|visible]:animate-*` -> `opacity-0 transition-opacity delay-200 data-scrolling:opacity-100 data-scrolling:delay-0`. Base clears `data-scrolling` 500ms after the last scroll (`scroll-area/constants.js` `SCROLL_TIMEOUT`), and the extra 200ms keeps the old 700ms hide.
  - removed `[&>div]:!block` and its Radix `display: table` comment: Base's Viewport has no wrapper div, so that selector would have forced `display: block` on consumers' own first child
- Consumers:
  - `type="scroll"` removed in:
    - `src/SummaryPanel.tsx:152`
    - `src/ProjectsView.tsx:152`
    - `src/pane/NoPanes.tsx:34`
    - `src/pane/AgentsTab.tsx:105, :400, :474`
    - `src/pane/ArtifactsTab.tsx:66`
    - `src/pane/VisualTab.tsx:11`
    - `src/pane/PortsTab.tsx:85`
    - `src/settings/SettingsPage.tsx:48`
    - `src/notify/NotificationBell.tsx:137`
    - `src/chat/RefHoverCard.tsx:260`
    - `src/settled/SettledView.tsx:56`
    - `src/browser/Toolbar.tsx:213`
    - `src/files/FileFinder.tsx:154`
  - Radix `display: table` workarounds removed (each would now hit the consumer's own flex/grid child):
    - `src/pane/PrTab.tsx:~187`: `[&_[data-slot=scroll-area-viewport]>div]:block!` and its comment
    - `src/pane/ChangesTab.tsx:~195, :~203`: the same, plus `type`
    - `src/replay/ReplayView.tsx:~716`: `>div]:!block` plus `type`
    - `src/NewThreadView.tsx:93`: `>div]:h-full`. The child grid's `min-h-full` now resolves against the viewport directly.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" scroll-area.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `[&>[data-slot=scroll-area-viewport]]:max-h-*` and `*:data-[slot=scroll-area-viewport]:*` consumers (ChatView, QueueTray, RefHoverCard, NotificationBell, WorktreeMenu): the viewport is still a direct child with that data-slot.
- `files/FileFinder.tsx:79` querying `[data-slot=scroll-area-viewport]`: still valid.

## Behavior changes

- Radix unmounted the hidden scrollbar. Base keeps it mounted at `opacity-0` whenever content overflows, so an invisible scrollbar can still be grabbed at the edge. Flagged, not patched.
- The hide timing is approximate: 500ms Base timeout + 200ms CSS delay, then a 150ms fade.
- Viewport children are no longer wrapped in a `display: table` div. Content lays out at viewport width, which is what every workaround above was forcing.

## Verify by hand

- Scroll the settings page, the changes pane diff and the PR pane. The scrollbar appears while scrolling and fades about 0.7s after. Long diff lines scroll inside their own block, not the whole pane.
- New thread view: the hero and composer still fill the height, with the composer at the bottom.
- The notification bell and ref hover card lists cap their height and scroll.
- The top/bottom scroll fade (`scroll-fade-y`) still shows on long lists. Check light and dark.
