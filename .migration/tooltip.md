# tooltip

2026-11-04, golden-pair merge (radix-nova -> base-nova, hand-resolved). Migrated; `animate-tooltip` selectors moved to Base UI attributes with timing unchanged.

## Changed

- `apps/desktop/src/components/ui/tooltip.tsx`: import `@base-ui/react/tooltip`; Provider `delayDuration=0` -> `delay=0`; Portal > Positioner (`isolate z-50`) > Popup. `side`/`sideOffset`/`align`/`alignOffset` are declared, destructured and forwarded to the Positioner. The user's `sideOffset = 10`, `animate-tooltip`, no arrow and no transform-origin are all kept (the golden's `origin-(--transform-origin)` was left out because the user had removed the radix origin).
- `apps/desktop/src/index.css` `@utility animate-tooltip` (~line 1061): `&[data-state='closed']` -> `&[data-closed]` in both the normal and the `motion-reduce` blocks. The comment now names Base UI's skip-delay attribute `data-instant` (value `'delay'`, from `tooltip/popup/TooltipPopupDataAttributes.d.ts`). There is deliberately no `data-instant` rule: under Radix, `instant-open` played the same `tooltip-in`, so leaving it unstyled keeps the timing.
- `src/App.tsx:77`: `TooltipProvider delayDuration={400}` -> `delay={400}`.
- `asChild` -> `render` on TooltipTrigger: `ui.tsx` (TooltipIconButton, `render={disabled ? <span>{button}</span> : button}`), `threadRow`, `PlacePicker`, `ZoomChip`, `ProjectsView`, `ModelControls`, `Sidebar`, `AddToProject`, `ThreadView`, `pane/{FilesTab,SideChatTab,PaneHeader,SimulatorTab}`, `settings/{ProfileInstructions,sections/appearance,sections/profiles}`, `design/sections/{overlays,native-items}`, `chat/SteerBubble`, `sidechat/AskInSideChat`, `layout/SplitControls`, `agents/parts`, `library/ConnectorPage`, `rewind/RewindLayer`, `browser/{Toolbar,Annotate}`, `viz/{CodeFrame,VisualFrame,SortableTable}`, `files/FileFinder`, `menus/ActionItems`, `remote/{origin,computers,MachinePresence}`, `components/ai-elements/{message,prompt-input}`. Nested triggers (Tooltip > DropdownMenu/Popover trigger > Button) are collapsed into nested `render` chains, which also converts the inner trigger's `asChild` (menu family) where it was still radix. A JSX comment that sat inside a trigger was hoisted above it.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" tooltip.tsx` is empty.
- Typecheck: no errors in tooltip.tsx or the consumers above.

## Left alone

- `src/index.css` `animate-pop` `[data-state='instant-open']` rules: tooltip leftovers inside the menu/popover utility, now dead. They are not tooltip-owned and belong to the motion pass.
- Comments in `settings/sections/profiles.tsx:420,474`, `library/ConnectorPage.tsx:195,644` and `browser/Annotate.tsx:183` say the tooltip trigger's `data-state` overwrites the child's. Base UI uses `data-popup-open` instead, so the collision is gone and the comments are stale. The wrapper workarounds they describe are harmless, so I left both comments and code.

## Behavior changes

- Skip-delay window: Radix `skipDelayDuration` defaulted to 300ms. Base UI's equivalent Provider `timeout` defaults to 400ms, so moving between tooltips stays instant for 100ms longer.
- Base UI tooltips stay hoverable by default (Radix did too; `disableHoverableContent` was unused).
- The Trigger renders `<button>` by default; every call site passes its own element via `render`.

## Verify by hand

- Hover a header icon button: the tooltip appears after 400ms with the soft blur-in, 10px from the trigger. Move to the next button: it appears instantly with the same blur-in. Move away: it blurs out over 180ms.
- With reduced motion on, it fades only.
- Disabled buttons wrapped in spans (PlacePicker clone, Library "Always on", AddToProject chip) still show their tooltip.
- Toolbar console button and split-layout button: hover shows the tooltip, click opens the popover or menu, and both close correctly.
- Check light and dark: `bg-foreground text-background` inverts.
