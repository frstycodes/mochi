import type { Manifest } from './manifest.ts';

export interface Notice {
  title: string;
  body?: string;
}

export interface NotifyHost {
  show(notice: Notice): Promise<void>;
}

export const notifyMethods = {
  show: 'invoke',
} satisfies Manifest<NotifyHost>;
