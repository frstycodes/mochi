# toggle-group

2026-11-04, golden-pair merge (1 conflict resolved by hand). Migrated: the group is the callable `@base-ui/react/toggle-group`, and items reuse the `@base-ui/react/toggle` primitive. User customizations kept: `spacing = 0` default, the `data-[size=sm]:rounded-md` radius, and outline `-ml-px`/`-mt-px` overlap instead of border removal.

## Changed

- `apps/desktop/src/components/ui/toggle-group.tsx`: props `ToggleGroupPrimitive.Props` / `TogglePrimitive.Props`; item `data-[state=on]:z-[1]` -> `data-pressed:z-[1]`.
- Consumers: `type="single"` removed, `value={x}` -> `value={[x]}`, and `onValueChange={(v) => ...}` -> `onValueChange={([v]) => ...}`. The semantics are the same: deselecting yields `[]`, so `v` is `undefined` where Radix gave `""`, and every existing `v &&` / `v || fallback` guard still holds.
  - `src/AddProject.tsx:514`
  - `src/settings/AppIconPicker.tsx:14`
  - `src/settings/ProfileAgentConfig.tsx:229`
  - `src/settings/parts.tsx:381`
  - `src/settings/sections/remote.tsx:277 (`type="multiple"`->`multiple`)`
  - `src/settings/sections/profiles.tsx:407, :464`
  - `src/design/DesignPage.tsx:~225, :~691 (`defaultValue="claude"`->`defaultValue={['claude']}`)`
  - `src/design/sections/zoom-chip.tsx:15`
  - `src/design/sections/agent-loader.tsx:93 (`onValueChange={pick}`->`([v]) => v && pick(v)`)`
  - `src/design/sections/native-items.tsx:167, :231`
  - `src/design/sections/merge-button.tsx:27`
  - `src/library/LibraryParts.tsx:463`
  - `src/library/ConnectorPage.tsx:645`
  - `src/browser/Compare.tsx:53`
  - `src/browser/Annotate.tsx:175`
  - `src/files/MarkdownView.tsx:30`
  - `src/files/FileViewer.tsx:173`
  - `src/replay/ReplayView.tsx:488`
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" toggle-group.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `src/settings/sections/profiles.tsx:420` comment about tooltip `data-state` overwriting the toggle's: the tooltip family's. It now describes Radix attributes, but the wrapper span is still harmless.
- `rovingFocus`/`loop`: not used anywhere.

## Behavior changes

- The wrapper still does not forward `orientation` to the primitive (radix wrapper didn't either), so vertical groups get horizontal arrow-key semantics from Base's default. There are no vertical groups in the app today.
- `onValueChange` receives `(string[], eventDetails)`.

## Verify by hand

- Design page theme switcher, file viewer preview/source, markdown view toggle, replay speed: click switches the value; clicking the active item does not clear it.
- Library category chips and the design library filter: clicking the active chip falls back to "All".
- Settings > Remote device scopes (multiple): toggling several scopes saves each one.
- Arrow keys move focus within a group.
