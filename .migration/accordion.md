# accordion

2026-11-04, golden-pair merge (radix-nova -> base-nova, conflicts hand-resolved against disclosure.md). Migrated; user customizations kept (FoldChevron icon, `group/fold`, 150ms custom ease, `motion-reduce:animate-none!`).

## Changed

- `apps/desktop/src/components/ui/accordion.tsx`: import `@base-ui/react/accordion`; prop types to `AccordionPrimitive.<Part>.Props`; `Content` -> `Panel`; trigger `disabled:*` -> `aria-disabled:*` (golden); panel `data-[state=closed|open]:animate-accordion-*` -> `data-closed:` / `data-open:` (Base UI accordion panels do emit `data-closed`: `accordionStateAttributesMapping` spreads `collapsibleOpenStateMapping`, checked in `node_modules/@base-ui/react/accordion/item/stateAttributesMapping.js`; the `.d.ts` omits it); inner div gets the golden `h-(--accordion-panel-height) data-starting-style:h-0 data-ending-style:h-0`. Removed the now-unused `React` import. The `accordion-down/up` keyframes come from `shadcn/tailwind.css`, which already falls back to `--accordion-panel-height`.
- `apps/desktop/src/Fold.tsx:76`: `FoldChevron` `group-data-[state=open]/fold:rotate-90` -> `group-data-panel-open/fold:rotate-90`. The accordion trigger carries `group/fold`, and Base UI triggers mark open with `data-panel-open`.
- `apps/desktop/src/SummaryPanel.tsx:~198`: `type="multiple"` -> `multiple`; `asChild` + `<Reorder.Group>` child -> `render={<Reorder.Group .../>}`; `AccordionItem asChild` + `<Card>` -> `render={<Card className={CARD} />}`.
- `apps/desktop/src/library/SkillGroups.tsx:33`: `type="multiple"` -> `multiple`.
- `apps/desktop/src/library/ConnectorPage.tsx:477`: `type="multiple"` -> `multiple`.
- `apps/desktop/src/design/sections/data.tsx:211`: `type="single" collapsible defaultValue="settle"` -> `defaultValue={['settle']}`.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" accordion.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The 2 remaining errors are in `prompt-input.tsx` and `command.tsx` (other families).

## Left alone

- `apps/desktop/src/index.css`: has no accordion rules.
- `apps/desktop/src/Fold.tsx`: the collapsible changes are recorded in collapsible.md.

## Behavior changes

- Base UI single mode is always collapsible, so the design-page demo now lets you close its last open item. It used `collapsible` before, so nothing visible changes.
- `onValueChange` now passes `(value[], eventDetails)`. All consumers already took arrays.
- Roving arrow-key focus between triggers is gone (Base UI dropped it per the APG update). Tab moves between triggers instead.

## Verify by hand

- Summary panel: open and close each card. Height animates both ways, and drag-reorder still works with cards open.
- Library > skill groups and a connector page: groups expand and collapse, and the chevron rotates.
- Design page > Data: "When does a thread settle?" starts open, and clicking it closes it.
- Tab to a trigger: the focus ring shows, and Space or Enter toggles it.
