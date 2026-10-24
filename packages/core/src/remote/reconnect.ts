import { Schedule } from 'effect';

/**
 * How a device redials a machine (LAN and relay alike) and how a machine redials the relay: 1s doubling to 30s, each delay
 * jittered by ±20% so computers that lost the same relay don't all come back in the same instant.
 */
export const reconnect = Schedule.min([Schedule.exponential('1 second'), Schedule.spaced('30 seconds')]).pipe(Schedule.jittered);
