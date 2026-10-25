import { AGENT_CONTROLS, type AgentControl } from '../settings/prefs.ts';
import {
  tierOf,
  type Tier,
  type ToolName,
} from '@mochi/domain/runtime/toolTable';

/**
 * What one Mochi tool does when an agent calls it (Settings › Mochi access). `allow` runs it (a setting tool's widget
 * still only suggests), `ask` waits on an approval widget first, `off` refuses it.
 */
export type ToolPolicy = 'allow' | 'ask' | 'off';

/** Your per-tool choices; a tool left out follows the agent-control level. */
export type ToolPolicies = Partial<Record<ToolName, ToolPolicy>>;

/** Deletes always ask and settings are only ever suggested, so neither can be set to run on its own. */
export const POLICIES_BY_TIER = {
  read: ['allow', 'ask', 'off'],
  change: ['allow', 'ask', 'off'],
  destructive: ['ask', 'off'],
  setting: ['allow', 'off'],
} as const satisfies Record<Tier, readonly ToolPolicy[]>;

/** The least agent-control level each tier runs under. */
export const LEVEL = {
  read: 'read',
  change: 'changes',
  destructive: 'everything',
  setting: 'everything',
} satisfies Record<Tier, AgentControl>;

/** What a tier does at `control` with no choice of yours: off below its level, deletes ask, everything else runs. */
export function levelPolicy(tier: Tier, control: AgentControl): ToolPolicy {
  if (AGENT_CONTROLS.indexOf(control) < AGENT_CONTROLS.indexOf(LEVEL[tier]))
    return 'off';
  return tier === 'destructive' ? 'ask' : 'allow';
}

/** What `name` does now, and whether that's your own choice for it (then the level doesn't apply). A saved choice the tier doesn't offer is ignored. */
export function toolPolicy(
  name: ToolName,
  control: AgentControl,
  policies: ToolPolicies,
): { policy: ToolPolicy; isChosen: boolean } {
  const tier = tierOf(name);
  const chosen = policies[name];
  if (
    chosen &&
    (POLICIES_BY_TIER[tier] as readonly ToolPolicy[]).includes(chosen)
  )
    return { policy: chosen, isChosen: true };
  return { policy: levelPolicy(tier, control), isChosen: false };
}
