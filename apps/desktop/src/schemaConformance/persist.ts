import type * as Model from '../../../../packages/schema/src/model.ts';
import type * as Persist from '../../../../packages/schema/src/persist.ts';
import type { AutofixEvent, AutofixTarget } from '../git/autofix.ts';
import type { WorkspaceDraft } from '../git/workspace.ts';
import type { Mention } from '../chat/mentions.ts';
import type { FileEdit } from '../host/types/settings.ts';
import type * as M from '../model.ts';
import type { PaneLayout } from '../pane/layout.ts';
import type { Checkpoint } from '../rewind/checkpoints.ts';
import type { Fork } from '../rewind/fork.ts';
import type { ThreadControls } from '../runtime/controls.ts';
import type { Review } from '../secondOpinion/verdict.ts';
import type { McpServerDef } from '../settings/agentConfig.ts';
import type { Saved } from '../store/saved.ts';
import type { VizLanguage } from '@mochi/domain/viz/fence';
import type { Check, Decoded, Same } from './check.ts';

export type Conformance = [
  Check<Same<Decoded<typeof Model.Thread>, M.Thread>>,
  Check<Same<Decoded<typeof Model.QueueItem>, M.QueueItem>>,
  Check<Same<Decoded<typeof Model.ActivityEntry>, M.ActivityEntry>>,
  Check<Same<Decoded<typeof Model.Step>, M.Step>>,
  Check<Same<Decoded<typeof Model.Repo>, M.Repo>>,
  Check<Same<Decoded<typeof Model.ThreadControls>, ThreadControls>>,
  Check<Same<Decoded<typeof Model.AutofixEvent>, AutofixEvent>>,
  Check<Same<Decoded<typeof Model.AutofixTarget>, AutofixTarget>>,
  Check<Same<Decoded<typeof Model.FileEdit>, FileEdit>>,
  Check<Same<Decoded<typeof Model.McpServerDef>, McpServerDef>>,
  Check<Same<Decoded<typeof Model.Mention>, Mention>>,
  Check<Same<Decoded<typeof Model.WorkspaceDraft>, WorkspaceDraft>>,
  Check<Same<Decoded<typeof Model.Review>, Review>>,
  Check<Same<Decoded<typeof Model.VizLanguage>, VizLanguage>>,
  Check<Same<Decoded<typeof Model.PaneLayout>, PaneLayout>>,
  Check<Same<Decoded<typeof Persist.Checkpoint>, Checkpoint>>,
  Check<Same<Decoded<typeof Persist.Fork>, Fork>>,
  // `Saved.version` becomes `v`.
  Check<Same<Persist.Saved, Omit<Saved, 'version'>>>,
];
