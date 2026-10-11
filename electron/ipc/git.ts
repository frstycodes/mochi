import type { GitHost } from '../../src/host/types/git.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const git = {
  status: notImplemented('git.status'),
  diff: notImplemented('git.diff'),
} satisfies Handlers<GitHost>;
