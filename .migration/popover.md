# popover

2026-11-04, golden-pair merge (radix-nova -> base-nova, hand-resolved). Migrated; `PopoverAnchor` removed, and its 5 call sites now pass `anchor` to `PopoverContent`.

## Changed

- `apps/desktop/src/components/ui/popover.tsx`: import `@base-ui/react/popover`; Portal > Positioner (`isolate z-50`) > Popup. `align`/`alignOffset`/`side`/`sideOffset`, plus `anchor` and `collisionPadding` (both used by the app), are declared, destructured and forwarded to the Positioner. `origin-(--radix-popover-content-transform-origin)` -> `origin-(--transform-origin)`. The user's `animate-pop rounded-xl shadow-overlay` styling is kept. `PopoverTitle` / `PopoverDescription` now use Base UI's `Title`/`Description` parts (as in the golden). `PopoverAnchor` is deleted: Base UI has no Anchor part, and once the call sites moved nothing imports it.
- Anchors -> `anchor={ref}` on `PopoverContent`: `src/chat/CaretMenu.tsx`, `src/browser/AddressBar.tsx` (reuses its existing `anchorRef`), `src/Sidebar.tsx` (SpaceFooter `switcherRef`), `src/SummaryPanel.tsx` (FinishedTasks, AddSourceRow).
- Focus/dismiss handlers (per overlays.md):
  - `CaretMenu.tsx`: `onOpenAutoFocus`/`onCloseAutoFocus` preventDefault -> `initialFocus={false} finalFocus={false}`. `onInteractOutside` preventDefault -> `onOpenChange` ignores reasons `outside-press` and `focus-out`.
  - `AddressBar.tsx`: `onOpenAutoFocus` -> `initialFocus={false}`. `onInteractOutside` (inside-anchor check) -> `onOpenChange` calls `details.cancel()` for an `outside-press` whose target is inside `anchorRef`.
  - `settings/ShortcutRecorder.tsx`: `onOpenAutoFocus` conditional preventDefault -> `initialFocus={state.kind !== 'recording'}`.
- CSS vars: `--radix-popover-trigger-width` -> `--anchor-width` (CaretMenu, AddressBar), `--radix-popover-content-available-width` -> `--available-width` (CaretMenu), `--radix-popover-content-available-height` -> `--available-height` (`PlacePicker.tsx`, `notify/NotificationBell.tsx`).
- Trigger state class: `settings/sections/appearance.tsx` `data-[state=open]:border-foreground/20` -> `data-popup-open:border-foreground/20` (the SlotCard rendered by the ThemePicker trigger).
- `asChild` -> `render` on PopoverTrigger: `PlacePicker`, `AddToProject`, `ProjectsView` (x3), `pane/SimulatorTab`, `settings/FontPicker`, `settings/ShortcutRecorder`, `notify/NotificationBell`, `design/sections/{overlays,inputs,native-items}`, `browser/Toolbar` (nested in TooltipTrigger), `git/WorkspacePicker`, `chat/RefHoverCard` (`render={children}`), `settings/ThemePicker` (`render={children ?? <Button/>}`, `children` narrowed `ReactNode` -> `ReactElement`).
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" popover.tsx` is empty.
- Typecheck: no errors in popover.tsx or the consumers above.

## Left alone

- `src/index.css` `animate-pop`: already handles `data-open`/`data-closed`. Its `[data-state='instant-open']` lines are dead Radix-tooltip leftovers; they do nothing and belong to the motion pass.
- `src/routes/nav.ts:98`, `src/toast/Toaster.tsx:510`, `src/index.css:540` still list `[data-radix-popper-content-wrapper]`. Base UI popover popups carry `role="dialog"` (checked in `popover/popup/PopoverPopup.js`) and `data-slot="popover-content"`, so those selectors still match popovers. The dead radix selector is shared with menus/select and left for whoever removes radix last.

## Behavior changes

- Base UI Positioner defaults `collisionPadding` to 5 (Radix used 0) wherever a call site doesn't set it.
- `PopoverTitle` renders `<h2>` instead of a `<div>` and labels the popup (used only on the design page).
- AddressBar: Radix's `onInteractOutside` also covered focus moving outside. Only `outside-press` is handled now. Base UI's `focus-out` comes from focus leaving the popup (`FloatingFocusManager`), and focus never enters it here (`initialFocus={false}`), so I expect no difference. Not verified in the running app.
- `RefHoverCard` controlled branch: `PopoverTrigger render={children}` keeps `nativeButton` true. If a caller passes a non-`<button>` element, Base UI warns in dev. Callers seen pass Buttons; not exhaustively checked.

## Verify by hand

- Composer: type `@`. The caret menu opens above the composer at full width, focus stays in the editor, clicking in the editor leaves it open, Esc closes it.
- Browser address bar: focus it and type. The suggestion list opens under the field at the field's width, clicking inside the field keeps it open, clicking a row navigates.
- Sidebar footer: edit a profile. The popover opens above the profile switcher, right-aligned.
- Summary panel: "N finished" and "Add a source" open their popovers to the left of the row.
- Settings > Shortcuts: start recording. Focus stays on the recorder rather than jumping into the popover.
- Appearance: the open theme card shows the darker border.
