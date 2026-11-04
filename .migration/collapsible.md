# collapsible

2026-11-04, golden-pair merge (the wrapper was pristine, so it took the base-nova golden). Migrated. The app's `Fold` motion disclosure is kept, with one compatibility prop.

## Changed

- `apps/desktop/src/components/ui/collapsible.tsx`: replaced with the base-nova golden (`@base-ui/react/collapsible`, `Trigger`, `Panel`). Export names are unchanged.
- `apps/desktop/src/Fold.tsx`:
  - `onOpenChange` forwards `eventDetails` (new 2-arg signature).
  - `FoldChevron` `group-data-[state=open]/fold` -> `group-data-panel-open/fold`.
  - `FoldContent`: `forceMount asChild` + `<FoldBox>` child -> `keepMounted render={<FoldBox ... hidden={false} />}`.
  - The docblock now says "Base UI Collapsible".
- `apps/desktop/src/SidebarFold.tsx`: `<Fold asChild><SidebarGroup>` -> `<Fold render={<SidebarGroup className="mt-1 pt-0" />}>`.
- `apps/desktop/src/Sidebar.tsx` (Pinned and Threads folds): `<Fold asChild><motion.li ...>` -> `render={<motion.li ... />}`.
- `apps/desktop/src/settings/sections/models.tsx:146` and `appearance.tsx:154`: `CollapsibleTrigger asChild` + `<button>` -> the trigger itself carries the classes and `disabled` (it renders a `<button>`).
- `apps/desktop/src/settings/sections/appearance.tsx:~616` and `design/DesignPage.tsx:841`: `CollapsibleTrigger asChild` + `<Button>` -> `render={<Button .../>}`.
- `apps/desktop/src/chat/PlanRow.tsx:30` and `agents/SubagentRow.tsx:52`: `data-[state]:animate-collapsible-up/down` -> `h-(--collapsible-panel-height) transition-[height] duration-200 ease-out data-starting-style:h-0 data-ending-style:h-0 motion-reduce:transition-none`. tw-animate's `collapsible-*` keyframes read only `--radix-collapsible-content-height` and fall back to `auto`, so they would no longer animate.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" collapsible.tsx` is empty. Typecheck is clean for every file above.

## Left alone

- `apps/desktop/src/index.css`: the sidebar focus rule targets `[data-slot='collapsible-trigger']`, which is still emitted. No rule targets collapsible state.
- `FoldChevron isOpen` call sites: they are driven by props, not data attributes.

## Behavior changes

- FLAGGED, and kept with an explicit prop: Base UI's `keepMounted` panel sets `hidden` as soon as it closes when it detects no CSS animation on the panel. The motion-driven `FoldBox` animates with JS, so Base UI saw nothing to wait for, and in the browser the close collapsed instantly (height 0 / `hidden` at 30ms). `hidden={false}` on the render element (render-element props win in `useRenderElement`'s `mergeProps(props, render.props)`) restores the Radix behaviour. The closed fold is still `inert` at height 0, and the browser now shows height 148 -> 72 -> 13 -> 0 over about 140ms on close. Side effect: closed fold content is not `display:none`, just as under Radix forceMount.
- `CollapsibleTrigger` no longer emits `data-state`. It emits `data-panel-open` instead. Nothing else in app code keyed off it.
- PlanRow and SubagentRow now use a 200ms height transition in place of the tw-animate keyframe. The duration and ease-out curve match tw-animate's defaults.

## Verify by hand

- Sidebar: toggle Pinned, Threads and Settled. The chevron rotates, and height plus fade animate both ways, including a second click mid-fold.
- Drag a thread with Pinned closed. Both sections open as drop targets.
- Settings > Models "Choose per task" (also disabled when providers differ) and Appearance "Choose each animation" / theme family expand.
- In a chat with a plan row or subagent row, expand it. The height animates and nothing is clipped.
