# dropdown-menu

2026-11-04, golden pair (stock radix-nova / base-nova) with the user's customizations replayed by hand onto the base shape. Verdict: migrated to `@base-ui/react/menu`; typecheck clean for the wrapper and every consumer touched.

## Changed

- `apps/desktop/src/components/ui/dropdown-menu.tsx`: `Menu` primitive; `Content` is now `Portal > Positioner (isolate z-50 outline-none) > Popup`. `align`/`alignOffset`/`side`/`sideOffset`, plus `collisionPadding` (two consumers use it), are declared, destructured and forwarded to the Positioner. Label -> `GroupLabel`, ItemIndicator -> `CheckboxItemIndicator`/`RadioItemIndicator`, Sub -> `SubmenuRoot`, SubTrigger -> `SubmenuTrigger` (`data-[state=open]` -> `data-popup-open`). SubContent now composes `DropdownMenuContent` with the golden defaults (`align="start" alignOffset={-3} side="right" sideOffset={0}`). Kept: `animate-pop`, `p-1.5`, `shadow-overlay`, item paddings/gaps, `right-2.5` indicators, `mx-2 my-1.5` separator, `@/icons`, every data-slot. Vars: `origin-(--transform-origin)`, `max-h-(--available-height)`, `data-[state=closed]:overflow-hidden` -> `data-closed:overflow-hidden`.
- Width change (user request): Content went from `w-(--radix-dropdown-menu-trigger-width) min-w-32` to `w-max max-w-(--available-width) min-w-52`. Menus are now at least 13rem, grow with their content, and are capped at the viewport. SubContent went from `min-w-[96px]` to `min-w-44`. A consumer `w-*` still wins through `cn`, but `min-w-52` keeps a floor under it.
- Consumers (asChild -> `render`, children moved out of the render element; nativeButton={false} only on `browser/PageMenu.tsx`'s `<span>` anchor): Composer, MachineFilterMenu, ModelControls, ProjectFilterMenu, ProjectsView, Sidebar, SidebarNav, SummaryPanel, ThreadView, UserMenu, browser/PageMenu, browser/Toolbar, chat/DevServerCard, chat/MessageActions, components/ai-elements/prompt-input, design/sections/{model-pickers,native-items,overlays}, files/FileView, git/{ComparePicker,MergeButton,SwitchBranchDialog,WorktreeMenu}, layout/SplitControls, library/{AddSkillsDialog,ConnectDialog,ConnectorPage,LibraryPage,LibraryParts,NativeSections,PluginsView,SkillsView}, pane/{PaneHeader,SimulatorTab}, settings/HarnessAccounts, settings/sections/{access,appearance,models,profilePage}, settled/SettledView, sidechat/AskInSideChat, viz/{SortableTable,VisualFrame}.
- `onSelect` -> `onClick` on every DropdownMenu item (Base UI items do not fire `onSelect`; it still typechecks as the DOM `select` event, so tsc cannot catch a miss). `e.preventDefault()` keep-open handlers became: `closeOnClick={false}` (Toolbar zoom in/out, prompt-input add-attachments); removed on Checkbox/RadioItems, where Base UI already defaults to `closeOnClick={false}` (MachineFilterMenu, ThreadView, native-items, LibraryParts, NativeSections, UserMenu x2); conditional versions became `closeOnClick={!needsConfirm(mode)}` (Composer) and `closeOnClick={!keepsOpen}` (ModelControls model row). prompt-input's screenshot item forwards `onClick` instead of `onSelect`.
- `onCloseAutoFocus` -> Popup `finalFocus`: ModelControls (reset search, `return true` so focus still returns), browser/PageMenu (`finalFocus={false}`).
- `--radix-dropdown-menu-content-available-height` -> `--available-height` (ModelControls). `data-[state=checked]` -> `data-checked` (ModelControls HIDDEN_CHECK, ThreadView). `viz/EmbedFrame.tsx` gained `has-data-popup-open` next to `has-data-[state=open]` so frame actions stay visible while their menu is open.
- `DropdownMenuLabel` is now `Menu.GroupLabel`, which throws outside a `Group`/`RadioGroup` (verified in `menu/group/MenuGroupContext.js`). Labels outside a group were wrapped in `DropdownMenuGroup` along with the items they head, or moved inside the following `DropdownMenuRadioGroup`: MachineFilterMenu, ProjectFilterMenu, UserMenu (4), chat/MessageActions, design/sections/native-items, git/ComparePicker, git/WorktreeMenu, library/{LibraryPage,LibraryParts,NativeSections}, pane/SimulatorTab, threadRow.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" src/components/ui/dropdown-menu.tsx` returns nothing.
- Checks run: `pnpm exec tsc -b` (no errors in the wrapper or any touched consumer; the remaining errors belong to the button/accordion/toggle-group/slider/checkbox families), `vp lint` on the touched files (exit 0; 4 warnings, none on changed lines), and `vp fmt` on the touched files.

## Left alone

- `command.tsx` (cmdk), plus vaul and sonner: not radix.
- `threadRow.tsx` `SidebarMenuAction asChild` wrapping a `DropdownMenuTrigger`: that `asChild` belongs to the sidebar family.
- `TooltipTrigger asChild` wrapping a `DropdownMenuTrigger` (ModelControls, ThreadView, etc.): that `asChild` belongs to the tooltip family. The inner trigger is migrated, so the Slot merge still lands on the Base UI trigger.
- Consumer widths narrower than the new 13rem floor. These now render at 13rem (min-width beats width) and were not edited because they don't look broken: `library/ConnectorPage.tsx:589` `w-48`, `settled/SettledView.tsx:317` `w-48`, `viz/SortableTable.tsx:244` `w-40`, `viz/VisualFrame.tsx:202` `w-40`. `git/SwitchBranchDialog.tsx:167` uses `w-auto`. Several menus set `w-52`, which equals the floor. SubContent `w-60`/`w-52`/`w-72` are all above `min-w-44`.

## Behavior changes

- Checkbox/RadioItems that used to close the menu on click now stay open (Base UI `closeOnClick` defaults to false). Flagged, not patched: ModelControls effort and speed radios; ProjectFilterMenu; ThreadView pane checkbox (line ~642); browser/Toolbar devtools/theme radios and its 3 checkboxes; chat/MessageActions rewind radio (runs `a.run` and stays open); git/MergeButton; library/{AddSkillsDialog,ConnectDialog,ConnectorPage,LibraryPage}; pane/SimulatorTab Dynamic Type. Add `closeOnClick` where closing is wanted.
- Content no longer matches the trigger's width. It sizes to its content with a 13rem floor (requested change).
- Base UI loops keyboard focus by default (Radix `loop` defaulted to false). `collisionPadding` defaults to 5 instead of 0.
- ModelControls keeps a comment about Radix focusing the content when the pointer leaves an item. Base UI's focus behavior here was not verified; check that search still keeps focus.

## Verify by hand

- Open the model picker: search keeps focus while typing, arrow keys move through items, Enter picks, Escape closes and focus returns to the trigger.
- Composer permissions: choosing "Full access" keeps the menu open for the confirm; other modes close it.
- Browser toolbar "…": Zoom in/out keeps the menu open; other items close it.
- Right-click inside a browser page: the menu opens at the cursor and focus does not jump back afterwards.
- Hover a submenu (ComparePicker "Compare with", ProjectsView clone): it opens to the right, aligned to the item, and the sub-trigger shows the accent while open.
- Check in light and dark that menus are at least 13rem wide, long labels grow the menu, and nothing overflows the window.
