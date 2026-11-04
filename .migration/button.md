# button

2026-11-04, golden-pair merge (radix-nova -> base-nova, the one conflict resolved by hand). Migrated to the real `@base-ui/react/button` primitive. User customizations kept: the `rounded-full` base, the `danger` variant and its comment, the `ghost` accent hover, the `secondary` color-mix hover, the user's size scale (including the `xs`/`icon-xs` `after:` hit-area insets), and the per-size radii.

## Changed

- `apps/desktop/src/components/ui/button.tsx`: `Slot`/`asChild` -> `ButtonPrimitive` from `@base-ui/react/button`. Props are now `ButtonPrimitive.Props & VariantProps<typeof buttonVariants>`. I kept `data-variant`/`data-size` (the base golden drops them) because `src/index.css:716-750` styles `button[data-size^='icon']`. Exports (`Button`, `buttonVariants`) are unchanged.
- Consumers, `asChild` + `<a>` -> `nativeButton={false} render={<a ... />}`, children moved out of the `<a>`:
  - `src/pane/PrTab.tsx:176`
  - `src/chat/RefHoverCard.tsx:~311`
  - `src/design/DesignPage.tsx:~203` and `:~243`
  - `src/library/SkillsView.tsx:159` and `:~205`
  - `src/git/ShipBar.tsx:231`
- `src/components/ai-elements/prompt-input.tsx:1231`: the `handleClick` param is now typed `BaseUIEvent<React.MouseEvent<HTMLButtonElement>>` (imported from `@base-ui/react/types`), because `onClick` on the Base button carries `preventBaseUIHandler`.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" button.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `asChild` on non-button triggers that render a Button (Tooltip/Popover/HoverCard/ContextMenu/Collapsible/Sidebar): other families own those.

## Behavior changes

- Link buttons (`render={<a/>}` + `nativeButton={false}`) now get `role="button"` from Base UI's `useButton` (`internals/use-button/useButton.js:186`), so screen readers announce them as buttons, not links. Leaving `nativeButton` true would log a dev error instead. Flagged, not patched. If link semantics matter, render a plain `<a className={buttonVariants(...)}>`.
- Base buttons handle Enter/Space through `useButton`. On a disabled button, `onClick` is blocked by `preventDefault`, the same as a native disabled button.

## Verify by hand

- Click "GitHub" in the PR pane, "Open on GitHub" in a ref hover card, the PR chip in the ship bar, and both skills.sh links. Each should open externally, with no console error about `nativeButton`.
- Tab to a link button and press Enter: it should open once, not twice.
- Design page header: the section nav links scroll smoothly, and "Open app" renders.
