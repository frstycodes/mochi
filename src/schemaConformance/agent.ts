import type { Agent, Model } from '../../packages/schema/src/index.ts';
import type * as A from '../host/types/agent.ts';
import type * as M from '../model.ts';
import type { Check, Decoded, Rpc, Same } from './check.ts';

export type Conformance = [
  Check<Same<Decoded<typeof Model.AgentInfo>, M.AgentInfo>>,
  Check<Same<Decoded<typeof Model.SentImage>, M.SentImage>>,
  Check<Same<Decoded<typeof Model.PullRequest>, M.PullRequest>>,
  Check<Same<Decoded<typeof Model.Space>, M.Space>>,
  Check<Same<Decoded<typeof Model.PaneTabKind>, M.PaneTabKind>>,
  Check<Same<Decoded<typeof Agent.AgentEvent>, A.AgentEvent>>,
  Check<Same<Decoded<typeof Agent.SeqAgentEvent>, A.SeqAgentEvent>>,
  Check<Same<Decoded<typeof Agent.AgentStartOptions>, A.AgentStartOptions>>,
  Check<Same<Decoded<typeof Agent.AgentSendInput>, A.AgentSendInput>>,
  Check<Rpc<A.AgentHost, typeof Agent.agentRpc>>,
];
