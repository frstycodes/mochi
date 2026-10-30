import { Schema } from 'effect';
import WebSocket from 'ws';
import { Capabilities, Relay } from '@mochi/schema';
import type { Link } from './link.ts';

const decodeDeviceFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(Relay.DeviceLinkFrame),
);

export interface TunnelOptions {
  /** Core's socket address, without a token (`coreUrl` minus its fragment). */
  url: string;
  /** Minted for this connection (`mintDeviceToken`): Core holds the device to its scopes like any client's. */
  token: string;
  /** Core's own certificate when it serves TLS: trusted alone (no system CAs), so its name needn't match the address dialed. */
  ca?: Buffer;
  onMembers?: (members: unknown) => void;
  /** A frame that is neither an RPC message nor membership records; the link is closed after it. */
  onMalformed: (frame: string) => void;
}

/**
 * Carries a paired device's frames to Core as one more WebSocket client, and Core's answers back, untouched. The device
 * speaks Core's own RPC, so there is no protocol here to keep in step with Core's.
 */
export function tunnel(link: Link, options: TunnelOptions) {
  const core = new WebSocket(
    options.url,
    Capabilities.subprotocolsFor(options.token),
    options.ca && {
      ca: options.ca,
      // Node's TLS reads a returned value as the error (`tls.checkServerIdentity`); ws types it as a boolean.
      checkServerIdentity: (() => undefined) as unknown as () => boolean,
    },
  );
  const held: string[] = [];
  link.onMessage((text) => {
    const frame = decodeDeviceFrame(text);
    if (frame._tag === 'None') {
      options.onMalformed(text.length > 200 ? `${text.slice(0, 200)}…` : text);
      return link.close(4400, 'Malformed frame');
    }
    if ('type' in frame.value) return options.onMembers?.(frame.value.members);
    if (core.readyState === core.OPEN) core.send(text);
    else held.push(text);
  });
  link.onClose(() => core.close(1000, 'The device left'));
  core.on('open', () => {
    for (const text of held.splice(0)) core.send(text);
  });
  core.on(
    'message',
    (data: Buffer) => link.isOpen() && link.send(data.toString('utf8')),
  );
  // Every failure also closes the socket; the close is what's acted on.
  core.on('error', () => {});
  core.on('close', () =>
    link.close(1011, 'This computer’s Core closed the connection'),
  );
}
