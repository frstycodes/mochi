# context-menu

2026-11-04, golden pair (stock radix-nova / base-nova) with the user's customizations replayed by hand. Verdict: migrated to `@base-ui/react/context-menu`; typecheck clean for the wrapper and every consumer touched.

## Changed

- `apps/desktop/src/components/ui/context-menu.tsx`: Base UI ContextMenu parts; Content is `Portal > Positioner > Popup` with the golden defaults `align="start" alignOffset={4} side="right" sideOffset={0}` (Radix's built-in context positioning was side right / align start), declared, destructured and forwarded. Label -> `GroupLabel`, ItemIndicator -> `CheckboxItemIndicator`/`RadioItemIndicator`, Sub -> `SubmenuRoot`, SubTrigger -> `SubmenuTrigger` with `data-popup-open` styling. SubContent composes `ContextMenuContent` (golden shape). The user's Trigger additions survive: the menu key / Shift F10 open, and the native menu for inputs and text selections. That still works because Base UI's Trigger opens from React `onContextMenu`, and the document-level `contextmenu` preventDefault never sees an event already stopped in capture (read in `context-menu/trigger/ContextMenuTrigger.js`). Two comments that named Radix now name Base UI. Kept: `animate-pop`, `p-1.5`, `shadow-overlay`, classes, `@/icons`, data-slots. `origin-(--transform-origin)`, `max-h-(--available-height)`.
- Width change (user request): Content `min-w-36` -> `min-w-52`, plus `max-w-(--available-width)`. SubContent `min-w-32` -> `min-w-44`.
- Consumers: `asChild` -> `render`. Where the trigger child was `{children}`, the prop is now typed `ReactElement` and passed as `render={children}`: ProjectsView (`ContextMenuTrigger render={children}`), files/FileContextMenu, files/FileTree (`RowMenu` children type), menus/TargetContextMenu, menus/ThreadRowMenu (`children: ReactElement` & `Omit<…, 'children'>`), chat/MessageContextMenu. Element children: Sidebar (`<div className="contents">`), WebLinks (`<button>`), chat/ChatLink (`<a>`).
- `onSelect` -> `onClick` on ContextMenuItems: Sidebar, WebLinks, chat/ChatLink, chat/MessageContextMenu, files/FileContextMenu, menus/ThreadRowMenu, menus/ActionItems (both `MENU_PARTS` Item call sites, through `onClick`). `SkippedItem` swaps its keep-open `onSelect` preventDefault for `closeOnClick={false}`.
- Sidebar `SidebarContextMenu`: `onCloseAutoFocus` (preventDefault, then run the deferred editor) -> `finalFocus={() => { afterClose(); return false }}`. It runs in the same teardown slot, verified in `floating-ui-react/components/FloatingFocusManager.js`.
- `ContextMenuLabel` outside a group would throw: menus/ActionItems bulk header is now wrapped in `ContextMenuGroup`.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" src/components/ui/context-menu.tsx` returns nothing.
- Checks run: `pnpm exec tsc -b` (no errors in my files), `vp lint` (exit 0), and `vp fmt` on touched files.

## Left alone

- No consumer used `modal` on ContextMenu or `disabled` on ContextMenuTrigger (grepped), so there was nothing to remove.
- Consumer widths: every ContextMenuContent sets `w-52` or `w-60` (ProjectsView, MessageContextMenu `w-52`; WebLinks `w-56`; TargetContextMenu, ThreadRowMenu, FileContextMenu `w-60`). None is narrower than the floor.
- The `menus/ActionItems.tsx` comment "Not Radix `disabled`…" was not changed. Whether Base UI disabled items stay focusable was not checked.

## Behavior changes

- Base UI ContextMenu also opens on touch long-press, which Radix did too. It closes on a mouseup outside the popup only after the long-press delay. Behavior is close to Radix but not identical.
- Main menu offset: 4px down from the pointer (`alignOffset={4}`), instead of Radix's 2px to the right.
- Keyboard focus loops by default.

## Verify by hand

- Right-click a sidebar thread, a file-tree row and a chat link: the menu opens at the cursor, arrow keys and typeahead work, Escape closes.
- Focus a thread row and press Shift F10 or the menu key: the menu opens under the row.
- Select chat text and right-click: you get the native Copy menu, not the app's.
- Sidebar background "Edit profile…": the editor opens after the menu closes and stays open.
- Hover a submenu: it opens to the right and the parent row stays highlighted.
- Check width in light and dark.
