# Build sessions

How the work in [CHECKLIST.md](CHECKLIST.md) is split into parallel sessions. Each session runs in its own worktree on branch `feat/<id>`, commits there, and never merges to `main`; the coordinating session merges each wave, then starts the next.

Decided: Electron desktop shell; the web build (Vite single file / artifact) keeps working with mocked host features.

## Rules for every session

- Own only the files listed for your session. Need a change in a file another session owns → make the smallest possible edit and say so in your final report.
- Shared hotspots, one-line edits only: `src/host/index.ts` (namespace registry), `src/pane/tabs.ts` (tab registry), `src/store/index.tsx` (slice registry), `package.json` (deps/scripts), `.claude/launch.json` (append your own entry with your port).
- Done means: `pnpm typecheck` and `pnpm test` pass; UI changes verified in the browser preview in light and dark; Electron features also run once in `pnpm electron:dev`. Report the commands and results verbatim.
- Non-trivial logic leaves one `node --test` check (`src/**/*.test.ts`).
- Follow `DESIGN.md` (tokens, type scale, radii, motion) and reuse `src/components/ui` primitives.
- Commit in conventional, scoped commits on your branch. No attribution lines.

## Contracts (created in wave 0, filled in later waves)

- **Host bridge** `src/host/`: `host.<namespace>` typed API. In Electron it calls `window.harnessHost` (preload, `contextBridge`) → `ipcMain` handlers in `electron/ipc/<namespace>.ts`. In the web build each namespace has a mock in `src/host/web/<namespace>.ts`. `host.isDesktop` tells the UI which one it got. Namespaces: `pty`, `git`, `fs`, `ports`, `sim`, `browser`, `notify`, `windows`, `agent`.
- **Pane tab registry** `src/pane/tabs.ts`: `PaneTabKind` → `{ title, icon, component }`; each kind lives in `src/pane/<Kind>Tab.tsx`. Kinds: `browser`, `changes`, `terminal`, `files`, `simulator`, `ports`, `sidechat`, `new`.
- **Store slices** `src/store/`: `threads` (goal, steps, revisions, tick sim), `queue`, `panes`, `layout`, `ui`. Root reducer composes slices; `useHarness()` and the existing selectors keep their signatures.

## Wave 0: foundation (2 sessions, parallel)

| Id | Session | Owns |
|---|---|---|
| `shell` | Electron shell + host bridge | `electron/**`, `src/host/**`, `package.json`, `vite.config.ts`, `index.html` |
| `slices` | Store slices + pane tab registry + pane shell (§1 Panel shell) | `src/store/**`, `src/store.tsx` (removed), `src/pane/**`, `src/SidePane.tsx`, `src/model.ts` |

## Wave 1: features (8 sessions, parallel)

| Id | Session | Checklist | Owns |
|---|---|---|---|
| `browser` | Real browser tab | §1 Browser | `src/pane/BrowserTab.tsx`, `src/Browser.tsx`, `electron/ipc/browser.ts`, `src/host/*/browser.ts` |
| `term` | Terminal + ports + dev-server runner | §1 Terminal, Ports and previews | `src/pane/TerminalTab.tsx`, `src/pane/PortsTab.tsx`, `electron/ipc/{pty,ports}.ts`, `src/host/*/{pty,ports}.ts` |
| `git` | Changes tab + worktree manager | §1 Diffs, §6 Worktree manager | `src/pane/ChangesTab.tsx`, `electron/ipc/git.ts`, `src/host/*/git.ts` |
| `files` | File tree + editor + previews | §1 File preview / editor | `src/pane/FilesTab.tsx`, `electron/ipc/fs.ts`, `src/host/*/fs.ts` |
| `sim` | iOS simulator tab | §1 iOS simulator | `src/pane/SimulatorTab.tsx`, `electron/ipc/sim.ts`, `src/host/*/sim.ts` |
| `layout` | Splits + drag to pin + pinned tabs | §2, §3 Splits, Pinned tabs | `src/layout/**`, `src/store/layout.ts`, `src/Sidebar.tsx`, `src/reorder.ts`, `src/App.tsx` |
| `goals` | Goal editing + drift guard | §4 open items, §5 | `src/store/threads.ts`, `src/drift.ts`, `src/Composer.tsx`, `src/SummaryPanel.tsx`, `src/GoalTimeline.tsx` |
| `viz` | Chat visualizations | §7 | `src/ChatView.tsx`, `src/viz/**` |

## Wave 2: built on wave 1 (5 sessions, parallel)

| Id | Session | Needs | Checklist |
|---|---|---|---|
| `stage` | Stage Manager + Cmd ↑ overview + multi-window | `layout`, `shell` | §3 Stage Manager, Decided |
| `sidechat` | Side chat tab | `slices`, `viz` | §1 Side chat |
| `rewind` | Checkpoints / rewind, thread forking, agent handoff | `git`, `goals` | §6 3, 5, 7 |
| `review` | Review inbox + Cmd K actions | `git`, `layout` | §6 6, 8 |
| `notify` | Notifications center + cost / usage | `shell`, `goals` | §6 1, 2 |

## Wave 3: needs a real agent runtime or a server

Scheduled threads, team spaces, replay, voice, mobile companion, settings sync (§6 9–14). These wait until threads run on real Claude Code / Codex processes instead of the `tick` simulation. The runtime is designed in [RUNTIME.md](RUNTIME.md), with its own waves R0–R2.
