# sidebar

2026-11-04, engine transform on the user's own file (heavily customized; only the radix `Slot` usage was rewired, per the golden base-nova shape). Migrated. Widths, transitions, peek and resize behaviour are untouched.

## Changed

- `apps/desktop/src/components/ui/sidebar.tsx`:
  - `Slot` from `radix-ui` replaced by `useRender` + `mergeProps` (`@base-ui/react/use-render`, `@base-ui/react/merge-props`) in `SidebarGroupLabel`, `SidebarGroupAction`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuAction` and `SidebarMenuSubButton`.
  - `asChild?: boolean` props replaced by `render` (types are now `useRender.ComponentProps<tag>`).
  - `data-slot`, `data-sidebar`, `data-size` and `data-active` stay explicit props, unlike the golden, which moves them into useRender `state`. useRender state would emit `data-active=""` and drop `"false"`, which breaks `index.css:444` (`[data-sidebar='menu-button'][data-active='true']`).
  - `SidebarMenuButton` tooltip: `<TooltipTrigger asChild>{button}</TooltipTrigger>` -> `render: tooltip ? <TooltipTrigger render={render} /> : render` (golden shape; tooltip.tsx is already on Base UI).
  - `sidebarMenuButtonVariants`: `data-[state=open]:hover:*` -> `data-popup-open:hover:*`. Base UI menu and popover triggers emit `data-popup-open`, not `data-open` (checked in `menu/trigger/MenuTriggerDataAttributes.d.ts`). The golden's `data-open:` would not match a menu trigger.
- Consumers:
  - `Sidebar.tsx`: `SidebarMenuItem asChild` + `<motion.li>` -> `render={<motion.li .../>}`; `SidebarMenuButton asChild={isRenaming}` + `<div>` -> `render={isRenaming ? <div /> : undefined}`; `SidebarMenuAction asChild` + `<TooltipIconButton>` -> `render={<TooltipIconButton .../>}`.
  - `threadRow.tsx:175`: `SidebarMenuAction asChild` + `<DropdownMenuTrigger>` -> `render={<DropdownMenuTrigger aria-label="Snooze" />}`.
  - `design/sections/tilted-drag.tsx:109`: `SidebarMenuItem asChild` + `<motion.li>` -> `render`.
  - `settings/SettingsSidebar.tsx:94`: `SidebarMenuSubButton asChild` + `<button>` -> `render={<button .../>}`.
  - `SidebarFold.tsx`: see collapsible.md.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" sidebar.tsx` is empty. Typecheck is clean.

## Left alone

- Sheet, Tooltip, Button, Separator and Input wrappers are owned by other families. Sidebar's calls into them needed no API change beyond `TooltipTrigger render`.
- `sidebar.tsx:304` `peer-data-[state=collapsed]` and `[data-side][data-state=collapsed]` refer to the sidebar's own `data-state`, not radix.
- `index.css` sidebar rules (`[data-slot='sidebar-*']`, `[data-sidebar-peek]`, `[data-sidebar-resizing]`): all their attributes are still emitted.
- Other families' `asChild` near sidebar parts (`ThreadPeek` HoverCardTrigger, `ThreadRowMenu` context-menu trigger, `PopoverAnchor` in `Sidebar.tsx:1425`).

## Behavior changes

- None intended. Thread rows inherit `data-slot="hover-card-trigger"` from the outer `ThreadPeek` trigger, because incoming props override the wrapper's defaults. Radix Slot did the same (the child spread came last), so this is unchanged.

## Verify by hand

- Hover and active thread rows: the fill is right, and with the window inactive the selected row greys (the `data-active='true'` rule).
- Collapse to icon mode and hover a menu button: its tooltip appears to the right. Expanded, no tooltip.
- Hover a row: the Settle and Snooze actions appear. The Snooze menu opens, and its trigger keeps the hover fill while the menu is open.
- Rename a thread (double-click): the field is editable and keys do not activate the row.
- Settings sidebar sub-items navigate. Drag-reorder rows in Design > tilted drag.
