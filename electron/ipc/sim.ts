import type { SimHost } from '../../src/host/types/sim.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const sim = {
  list: notImplemented('sim.list'),
  boot: notImplemented('sim.boot'),
} satisfies Handlers<SimHost>;
