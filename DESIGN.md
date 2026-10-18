---
name: Mochi
version: 0.1 (draft for sign-off)
base: shadcn/ui (radix-nova), AI Elements for agent UI, Solar icons (`@solar-icons/react`), Tailwind v4
references: Linear (density, restraint, crisp hairlines), Raycast (floating windows, glass only over content, keyboard first), Codex (summary panel, collapsed work log)
themes: dark-first, light designed alongside
colors:
  neutral-hue: 285
  dark:
    background: oklch(0.145 0.006 285)
    sidebar: oklch(0.175 0.007 285)
    card: oklch(0.19 0.007 285)
    popover: oklch(0.205 0.008 285)
    float: oklch(0.205 0.008 285 / 0.9) + blur 24px
    foreground: oklch(0.965 0.003 285)
    muted-foreground: oklch(0.73 0.01 285)
    subtle-foreground: oklch(0.63 0.01 285)
    primary: oklch(0.965 0.003 285)
    accent: oklch(0.25 0.009 285)
    border: oklch(0.95 0.01 285 / 0.08)
  light:
    background: oklch(0.975 0.003 285)
    sidebar: oklch(0.99 0.002 285)
    card: oklch(0.997 0.001 285)
    foreground: oklch(0.2 0.01 285)
    muted-foreground: oklch(0.46 0.012 285)
    subtle-foreground: oklch(0.54 0.012 285)
    primary: oklch(0.22 0.01 285)
    accent: oklch(0.94 0.006 285)
    border: oklch(0.25 0.02 285 / 0.1)
  status: { success: 150, warning: 70-80, destructive: 25 }
  thread-lines: chart-1..5 (blue, orange, aqua, yellow, magenta), validated categorical order
  spaces: Latitude 165, Personal 15, Liane 80 (hue only; L and C are fixed per theme)
typography:
  family: Inter Variable (cv11, ss03), fallback system-ui; mono ui-monospace / SF Mono for code, paths and URLs only
  scale: { display: 24/28 600 -0.02em, heading: 18/24 600 -0.012em, title: 14/20 600, prose: 14/22 400, body: 13/20 400, meta: 12/18 400, caption: 11/16 400 }
rounded: { sm: 8px badges kbd checkboxes, md: 10px rows menu items small icon buttons, lg: 12px inputs selects icon buttons, xl: 18px cards panels summary card, 2xl: 24px composer side pane sheets PiP, full: text buttons chips dots radios, squircle: every tier x1.84 where corner-shape is supported, except anything rounded-full }
elevation: { flat: canvas sidebar side pane, hairline: cards (1px ring), popover: menus tooltips hover cards summary card, float: goal timeline window and the PiP }
motion: { press: 100-160ms, popover: 150-200ms ease-out, window snap: spring stiffness 420 damping 36, hover-intent: open 160ms close 240ms }
---

# Mochi design system

## Overview

A calm, dense workspace for running many coding agents at once. It should feel like Linear's restraint with Raycast's floating windows: dark-first, neutral, hairline-separated, and quiet until something needs you. Colour carries meaning (a thread's line, a status, a space), never decoration.

The signature artifacts are the chat (main view), the summary card with its floating timeline, the side pane and its pop-out preview, the attention queue, Orbit, and the metro board.

## Colors

- **Neutrals** lean slightly cool (hue 285, chroma ≤ 0.012). One grey family across the app.
- **No brand accent.** Primary actions are the inverted neutral (near-white on dark, near-black on light), like Raycast. Selection is the `accent` wash, never a hue.
- **Spaces** carry no color. The sidebar stays the same neutral in every space; a space is told apart by its icon (briefcase, home, layers) and name, like Arc's space icons. Space hues tinted too much of the UI and fought the thread line colors.
- **Thread lines** use the validated categorical order `chart-1…5`. A thread keeps its colour for life. Line colour marks identity only: the metro line, the progress ring, the dot next to a thread name. Text never wears a line colour.
- **Status** is reserved: success (running), warning (needs you), destructive (failed). Always paired with an icon or label.

## Color themes

Mochi's look is the built-in "Mochi" theme. Any VS Code color theme (Open VSX or a custom file) replaces it per appearance: `src/themes/map.ts` turns the theme's `colors` into Mochi's tokens, written as inline custom properties on `<html>` (`ColorThemeController`), so Mochi itself is no properties at all. The first key present wins; a missing token derives from `editor.background` / `editor.foreground`.

| Mochi token | VS Code keys, in order | Fallback |
|---|---|---|
| `background` | `editor.background` | `#1e1e1e` / `#ffffff` |
| `foreground` | `editor.foreground`, `foreground` | `#d4d4d4` / `#333333` |
| `sidebar` | `sideBar.background`, `activityBar.background` | background |
| `card` | `editorWidget.background`, `sideBarSectionHeader.background` | 4% foreground into background |
| `popover` (+ fg) | `editorHoverWidget.background`, `menu.background`, `quickInput.background`, `editorWidget.background` | card |
| `primary` / `-foreground` | `button.background` / `button.foreground` | foreground / background (the inverted neutral) |
| `secondary` / `-foreground` | `button.secondaryBackground` / `button.secondaryForeground` | 8% foreground |
| `muted` | `input.background` | 6% foreground |
| `muted-foreground` | `descriptionForeground` | 30% background into foreground |
| `subtle-foreground` | — | 42% background into foreground |
| `accent` / `-foreground` | `list.hoverBackground`, `list.inactiveSelectionBackground` / `list.hoverForeground` | 8% foreground over popover |
| `destructive` | `errorForeground`, `editorError.foreground`, `terminal.ansiRed` | VS Code ANSI red |
| `warning` | `editorWarning.foreground`, `terminal.ansiYellow` | ANSI yellow |
| `success` | `terminal.ansiGreen`, `gitDecoration.addedResourceForeground` | ANSI green |
| `info` | `textLink.foreground`, `editorInfo.foreground`, `terminal.ansiBlue` | ANSI blue |
| `merged` | `terminal.ansiMagenta` | ANSI magenta |
| `border` | `panel.border`, `sideBar.border`, `editorGroup.border`, `contrastBorder` | foreground at 10% |
| `input` | `input.border`, `dropdown.border`, `contrastBorder` | foreground at 15% |
| `ring` | `focusBorder` | 30% background into foreground |
| `highlight` | `editor.lineHighlightBackground` | foreground at 6% |
| `sidebar-accent` | `list.inactiveSelectionBackground`, `list.hoverBackground` | foreground at 7% |
| `chart-1…5` | ANSI blue, red+yellow (orange), cyan, yellow, magenta | VS Code ANSI defaults |
| `float`, `glass`, `glass-edge`, `scrim`, `chart-grid`, `chart-axis` | derived from popover, background and foreground at Mochi's alphas | — |

Rules the mapping enforces: translucent surfaces are painted over the background; every text token reads at 4.5:1 against the surfaces it sits on (lightness nudged in OKLab, hue kept: foreground on background, sidebar, card and popover; muted, subtle and status colours on those plus muted; each `-foreground` on its fill); `ring` at 3:1; chart lines at 3:1 on background; `accent` at least 0.04 L from popover so menu highlights show; a `border` under 1.15:1 or `input` under 1.3:1 against its surfaces falls back to translucent foreground. Token colours (`tokenColors`) feed every highlighter: pierre diffs and markdown code blocks get the theme as a shiki theme (`src/themes/highlight.ts`), the CodeMirror file viewer reads `--syntax-*` (first TextMate scope that resolves, `SYNTAX_SCOPES`), the terminal re-reads the tokens.

## Typography

Inter, one family. Hierarchy from size and weight, three weights (400, 500, 600). Mono only for code, file paths, branches, URLs and tool calls. `tabular-nums` on every changing number. Headings get slight negative tracking; captions get a hair of positive tracking.

Use the `type-*` utilities, never raw `text-[..px]`:

| Token | Spec | Use |
|---|---|---|
| `type-display` | 24/28 · 600 · −0.02em | Progress percentage, the one big number per surface |
| `type-heading` | 18/24 · 600 · −0.012em | Page titles (Queue, Board) |
| `type-title` | 14/20 · 600 | Thread title, panel titles, card titles |
| `type-prose` | 14/22 · 400 | Chat messages, composer |
| `type-body` | 13/20 · 400 | Default UI text; Tailwind `text-sm` is also 13px so shadcn components match |
| `type-meta` | 12/18 · 400 | Secondary lines, step rows |
| `type-caption` | 11/16 · 400 | Timestamps, counts, badges, tool calls |

## Layout

- App frame: sidebar 256px | chat | summary column 300px | side pane (resizable, 36% to start), like Codex. The summary docks on the right of the chat, not over it. The pane and summary dock from 1024px; below that they open as sheets from the header. The sidebar is resizable from its right edge (208–420px, double-click resets to 256, arrow keys when focused, remembered per browser) and collapses fully off-canvas (Cmd B or its header toggle); resting the pointer on the left edge slides it back as a floating panel, like Arc.
- Density: compact. Controls are 28px by default (24px small, 20px extra small, 32px large); sidebar rows are 26px at 13px text, list rows 28px; the thread header is 44px.
- Separation comes from surface steps (sidebar and side pane on `sidebar`, the summary on `card`, chat on `background`), not lines. No header borders, no row dividers, an invisible resize handle until hovered.
- Attention: one primary per screen (the chat and its composer), a few secondary (thread title, summary), everything else muted. Color only where something asks for you: a needs-you dot, a failed run, a diff stat.
- The chat column is capped at 720px and centred in the main area.
- 4px spacing grid. Inside a component 4–8px, between related items 8–12px, between groups 16–24px.
- Nothing adds top chrome on desktop beyond the thread header.

## Elevation

| Level | Surface | Used by |
|---|---|---|
| Flat | `background` (darkest), `sidebar` (one step lighter) | Chat canvas; sidebar and side pane |
| Hairline | `card` + 1px ring | Cards, queue decisions, tool runs, composer |
| Popover | `popover` + `shadow-popover` | Tooltips, hover cards, popovers, menus |
| Float | `float` (translucent) + blur + `shadow-float` | The expanded goal timeline window |

Glass (blur) is allowed only where content scrolls underneath: the composer and Float-level windows. Each level has exactly one hairline, and the elevation token owns it (`0 0 0 1px var(--border)` inside `shadow-popover` / `shadow-float`); overlays never add their own `border` or `ring` on top. In dark mode, depth comes from lighter surfaces, not heavy shadows.

## Shapes

Comfortably round, like Codex. Tiers: `sm` 8px (badges, kbd, checkboxes), `md` 10px (rows, menu items, small icon buttons), `lg` 12px (inputs, selects, icon buttons), `xl` 18px (cards, panels, the summary card), `2xl` 24px (composer, side pane, sheets, the PiP). Text buttons are capsules (`rounded-full`); icon-only buttons are rounded squares. `rounded-full` also for dots, rings, radios and switches, and those stay true circles under squircles. Nested shapes are concentric.

Corners are squircles. Where `corner-shape: squircle` is supported every radius token is multiplied by 1.84 (`--corner-scale`), which puts each corner's 45° point where the round fallback has it, so other browsers look equally round. Radii must come from the tokens: no `rounded-[Npx]`.

Icons are Solar, Linear style (Bold for `filled`), 16px in controls and 14px in dense rows. Real brand marks for Claude and Codex. Components import icons from `@/icons` by our names, never from the library: `src/icons/solar.tsx` maps Solar onto them, so trying another library means writing one more mapper file. Glyphs Solar lacks (fork, the Terminal and Changes pane marks, Shift and Option keys) are `customIcon`s drawn on its 24px grid at 1.5 stroke.

## Components

Everything is composed from the shadcn primitives in `src/components/ui`. App components add behaviour, not styling.

- **Thread row**: a three-line card like T3 Code. Top: a letter avatar for the project, project name, branch (mono), and time since the last activity, which a Settle button (Reactivate for settled threads) replaces on hover. Middle: the title. Bottom: a 12px progress ring in the thread's line color, the percentage, the step in flight (or the question it waits on, the PR ready for review), the latest PR number (green while open), and an amber dot when it needs you. Inactive rows are muted; the active row is the full-strength one.
- **Chat**: AI Elements `Conversation` and `Message`. An agent's name and time show once per run of its messages. Mochi events are a muted line with a flag icon, no separator rules.
- **Work log**: tool calls and reasoning between two messages collapse into one row, "Worked for 14m", followed by edited-file icons, `+x −y` and a command count (failed runs in red). While live, the row shows the agent loader and shimmers what the agent is doing ("Editing usage.tsx"), one quick 1.1s sweep then a 1.2s rest; expanded output and diffs use an inside `border`, never an outside ring, because the expand container clips. The shimmer band is the foreground color, so it reads bright in dark mode. Expanded rows: file-type icon (`@react-symbols/icons`), verb, path with the directory dimmed and the file name bright, `+x −y` and GitHub's five-block change bar. Edits expand to a syntax-highlighted diff (`@pierre/diffs`, Pierre themes); commands expand to their output with pass and fail lines colored and an exit badge.
- **Composer**: the star of the thread, and the one glass surface in the main view: it floats over the bottom of the transcript (messages scroll under it, the transcript pads itself by the composer's measured height) with a translucent fill, 20px backdrop blur, a hairline edge and float shadow; solid under reduced transparency. The tray, attachments and input share that one tone, with no inner fills or footer strips. A soft fade behind the meta row keeps it readable over scrolling text. A 24px-radius card holding, top to bottom: the question tray, attachment previews (image thumbnails, file chips), the textarea, and a footer with attach, model, reasoning effort and a round send button. Under it: permissions, branch, and the Cmd-to-queue hint; where the agent runs (this Mac, the only place yet) shows as the device icon in the thread header. 16px text on phones.
- **Model and effort pickers**: the model picker is a searchable popover grouped by harness (Claude Code, Codex) with each account plan, a star per model, a one-line note and context size. Hover either chip and scroll in any direction: a 3D carousel of free-floating tiles (no container) rises from it. The strip tracks the scroll 1:1 and moves with your fingers, the centre tile is lifted and enlarged, side tiles turn toward it and fall back in depth, each tile crossing the centre is a detent that selects it, and letting go snaps to the nearest one with a critically damped spring. Starred models only for the model chip.
- **Question tray**: pending decisions for the thread sit inside the composer, above the text, so they stay on screen while the chat scrolls. Scrolling up through the chat folds the tray to a one-line "Waiting on you" bar; coming back to the latest message unfolds it. The bar toggles it by hand, and it caps at 40% of the viewport.
- **Inline decision**: the same card as in the Queue. Questions use shadcn `Questionnaire` (number keys, one choice, send); approvals use AI Elements `Confirmation` with the command shown.
- **Summary column**: Codex's summary panel, extended for agents, docked to the right of the chat as a `card` surface (one step raised, hairline border). Opening it widens the column while the card rises out of the header toggle (scale 0.97 to 1, from its top-right corner). Contents: project and branch with an overflow menu; the goal (version, percentage, sparkline, pace, now / waiting / next steps), which opens the floating timeline on hover or with the expand button; Changes (+/−); Context usage; Pull requests; Skills used; Tools called; Sources. Lists longer than 3 show "View all".
- **Side pane**: docked right and resizable, on the `sidebar` surface. Browser-style tabs (the active tab is a raised chip) plus `+`: Preview, Changes, Terminal and a new-tab page. Toggling it animates the split; dragging the handle never animates.
- **Sidebar**: shadcn `Sidebar`, collapsible off-canvas. Header: the collapse toggle, then the space icon and name (plans in its tooltip). Search (Cmd K), New thread, Queue with a muted count, Board; pinned, active and settled threads. Footer: space icons (Ctrl 1–3 or a sideways swipe), theme, and a prototype menu.
- **Scrolling**: `ScrollArea` for panels and pages, scrollbar shown only while scrolling. Native scrollers (the chat, the sidebar) follow the same rule, and an auto-scroll from a new message never flashes the bar.
- **Agent loader**: one set of 160 dots that never swaps parts: each phase rearranges the same dots, and they flow into the next form when the phase changes, read from the latest activity. Only thinking shows them as dots; every other form packs them tight enough to read as solid strokes and fills. Every dot carries an ink level, drawn as five `currentColor` paths at stepped opacities (28 to 100%), dimmest first, so far and secondary parts sit back and near parts read bright, like thinking-orbs. Thinking is a dot globe turning slowly, back dots small and dim, with a bright meridian scanning across it; reading is an open book with shaded text lines and a page that turns every 2.2s; editing is a pencil (tapered nib, shaded band, wider dimmer eraser cap) that writes a wavy line, lifts and twirls end over end at the end of it, rubs the line out right to left with its eraser, and twirls back into a pen at the start, one 3.4s loop with no reset; running is two comets chasing round a circle, their tails thinning and fading; browsing is Saturn, a planet lit from the top left with a ring that dims and hides behind it, wobbles and carries a glint; waiting on you is one solid breathing dot. Dot positions, sizes and inks blend under critically damped springs (0.35s) that retarget mid-morph. Static form per phase under reduced motion. Used in the thread header while running and in the live work-log row.
- **Search**: `CommandDialog` on Cmd K across views, all threads and the current space's open steps.
- **Expanded goal**: outcome, criteria with their checks, the latest report, the agent's checklist while it works, and the goal's history.
- **Pop-out preview (PiP)**: a Preview tab popped out of the side pane. Chromeless like Codex: the page fills a 24px-radius window at float elevation; close, put back in the pane and comment appear only on hover, over a blurred patch in the top-left corner that fades out softly (a radial mask on a backdrop blur). The window itself never clips with `overflow: hidden`: Chromium drops a backdrop-filter's mask under a rounded overflow clip, so only the page inside is clipped. Drag anywhere, throw it to snap to a corner with its velocity, throw it past the edge to tuck it behind a 28px tab, resize from the inner corner. Never opens by itself.
- **Queue decision card**: kind and thread on top, the question as title, one-line consequence, then choices with number keys. Overlap choices are four bordered items with the suggested one marked.
- **Orbit**: inner ring = things that need you; outer ring = fixed slots (Queue N, Board S, New thread W, pins on the diagonals). Positions never move.
- **Metro board**: one line per thread, stations per step, shared steps as interchanges. Station labels run at 28° so they stay readable up to 24 characters; a pending overlap is a dashed warning curve with its label on a popover-level pill above the station.

## Do's and Don'ts

- Do keep one primary action per group. Don't put two filled buttons side by side.
- Do use line colour for identity marks only. Don't colour text or backgrounds with it.
- Do use the Float level only for windows over content. Don't blur cards, the sidebar or the header.
- Do pair every status colour with an icon or a word. Don't rely on green and amber alone.
- Do use brand marks for Claude and Codex. Don't use generic bot icons.
- Don't open floating windows without a user action.
- Don't animate keyboard-triggered navigation; hover intent and window physics may animate.

## Responsive

- Under 768px the sidebar becomes a drawer; Orbit opens on long-press.
- Under 1024px the summary and the side pane open as sheets from the header.
- The pop-out preview keeps at least 240×200 and clamps to the chat area.

## Known gaps

- Body text is 13px, meta 12px and captions 11px, matching Codex and T3 Code density; that is below the usual 14px floor for secondary text. Revisit if it reads small on non-Retina screens. Phones keep 16px in inputs so iOS doesn't zoom.
- Light mode is designed but less exercised than dark.
- Space icons are fixed per space until spaces get user-picked icons.
- Changes, PR and source rows in the summary panel open nothing yet; in the real app they open tabs in a side pane like Codex's (Changes, browser, Terminal, Files, Side chat, plugins).
- Trackpad haptics for the model and effort dock need the desktop shell (`NSHapticFeedbackManager`); browsers have no API for it, so the web build only vibrates on phones.
