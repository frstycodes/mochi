import type { Relay } from '@mochi/schema';

/** An RPC a device could send itself: its tag and the payload its handler takes. */
export interface DirectCall {
  readonly tag: string;
  readonly payload: unknown;
}

/**
 * The RPC a device command is, when it is exactly one: `device.command` runs that tag's own handler, so the command and the
 * RPC can't drift apart. Undefined for the rest, which are store actions (`storeCommand`) or still need a window's host.
 */
export function directCall(
  command: Relay.RemoteCommand,
): DirectCall | undefined {
  switch (command.type) {
    case 'browser-open': {
      const { threadId, tabId, url, width, height } = command;
      return {
        tag: 'page.open',
        payload: { threadId, tabId, url, viewport: { width, height } },
      };
    }
    case 'browser-input':
    case 'browser-navigate':
    case 'browser-close': {
      const { type, ...payload } = command;
      return { tag: BROWSER_TAGS[type], payload };
    }
    case 'setup-choice':
      return {
        tag: 'agent.setupChoice',
        payload: [command.threadId, command.choice],
      };
    case 'schedule':
      return command.action === 'run' || command.action === 'remove'
        ? {
            tag:
              command.action === 'run' ? 'schedule.runNow' : 'schedule.remove',
            payload: [command.threadId],
          }
        : {
            tag: 'schedule.setPaused',
            payload: [command.threadId, command.action === 'pause'],
          };
  }
  return undefined;
}

const BROWSER_TAGS = {
  'browser-input': 'page.input',
  'browser-navigate': 'page.navigate',
  'browser-close': 'page.unwatch',
} as const;
