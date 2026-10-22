import type * as P from '../../packages/schema/src/ipc/projects.ts';
import type * as R from '../../packages/schema/src/ipc/remote.ts';
import type * as Sc from '../../packages/schema/src/ipc/schedule.ts';
import type * as Si from '../../packages/schema/src/ipc/sim.ts';
import type * as Th from '../../packages/schema/src/ipc/themes.ts';
import type * as U from '../../packages/schema/src/ipc/usage.ts';
import type * as W from '../../packages/schema/src/ipc/windows.ts';
import type { ProjectsHost, CloneSource, Project } from '../host/types/projects.ts';
import type { RemoteHost, RemoteCommand, CommandResult, RemoteStatus, StreamFrame } from '../host/types/remote.ts';
import type { ScheduleEvent, ScheduleHost, Trigger, TriggerInput } from '../host/types/schedule.ts';
import type { SimHost } from '../host/types/sim.ts';
import type { ThemesHost } from '../host/types/themes.ts';
import type { UsageHost, UsageReport } from '../host/types/usage.ts';
import type { WindowsHost } from '../host/types/windows.ts';
import type { ColorTheme } from '../themes/model.ts';
import type { Check, Decoded, Rpc, Same } from './check.ts';

export type Conformance = [
  Check<Rpc<ProjectsHost, typeof P.projectsRpc>>,
  Check<Same<Decoded<typeof P.Project>, Project>>,
  Check<Same<Decoded<typeof P.CloneSource>, CloneSource>>,
  Check<Rpc<RemoteHost, typeof R.remoteRpc>>,
  Check<Same<Decoded<typeof R.RemoteCommand>, RemoteCommand>>,
  Check<Same<Decoded<typeof R.CommandResult>, CommandResult>>,
  Check<Same<Decoded<typeof R.RemoteStatus>, RemoteStatus>>,
  Check<Same<Decoded<typeof R.StreamFrame>, StreamFrame>>,
  Check<Rpc<ScheduleHost, typeof Sc.scheduleRpc>>,
  Check<Same<Decoded<typeof Sc.TriggerInput>, TriggerInput>>,
  Check<Same<Decoded<typeof Sc.Trigger>, Trigger>>,
  Check<Same<Decoded<typeof Sc.ScheduleEvent>, ScheduleEvent>>,
  Check<Rpc<SimHost, typeof Si.simRpc>>,
  Check<Rpc<ThemesHost, typeof Th.themesRpc>>,
  Check<Same<Decoded<typeof Th.ColorTheme>, ColorTheme>>,
  Check<Rpc<UsageHost, typeof U.usageRpc>>,
  Check<Same<Decoded<typeof U.UsageReport>, UsageReport>>,
  Check<Rpc<WindowsHost, typeof W.windowsRpc>>,
];
