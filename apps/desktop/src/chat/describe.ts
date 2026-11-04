import { hostname, shortCommand } from '../agentPhase.ts';
import { namesNow } from '../library/names.ts';
import type { ActivityEntry } from '../model.ts';
import { parseTool } from '../summary.ts';
import { mochiCall } from './mochiCalls.ts';

/** A tool call as a plain sentence for its work-group row: the agent's own description when it sent one (Claude's Bash), else one derived from the call; a command without one reads as itself, shortened. */
export function describeCall(
  entry: Pick<ActivityEntry, 'text' | 'description' | 'sent' | 'mcp'>,
) {
  if (entry.description) return entry.description;
  if (entry.sent) return `Messaging ${entry.sent.title}`;
  const call = parseTool(entry.text);
  const name = call.target.split('/').pop() || call.target;
  switch (call.verb) {
    case 'Read':
      return `Read ${name}`;
    case 'Edit':
      return `Edited ${name}`;
    case 'Write':
      return `Created ${name}`;
    case 'Search':
      return `Searched the web for “${call.target}”`;
    case 'Fetch':
      return `Read ${hostname(call.target)}`;
    case 'Browser':
      return 'Used the browser';
    case 'Skill':
      return `Used the ${namesNow().skill(call.target).title} skill`;
    case 'Mcp': {
      const mochi = mochiCall(call);
      if (mochi) return mochi[1];
      const [server, tool] = call.target.split(': ');
      return tool
        ? `Called ${namesNow().call(server, tool, entry.mcp?.account)}`
        : `Called ${namesNow().server(server).title}`;
    }
    case 'Run':
      return `Ran ${shortCommand(call.target)}`;
  }
}
