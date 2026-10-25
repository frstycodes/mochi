import type { ReactNode } from 'react';

export type ToastType =
  | 'default'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'loading';
export type ToastAction = { label: string; onClick: () => void };
/** `expand`: a widget the toast opens into when clicked, in place, like the Dynamic Island. */
export type ToastOptions = {
  id?: string;
  description?: ReactNode;
  action?: ToastAction;
  duration?: number;
  expand?: ReactNode;
};

export type Toast = {
  id: string;
  type: ToastType;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  expand?: ReactNode;
  duration: number;
  /** Times the same toast fired while it was still up. */
  count: number;
  /** Bumped on every update, so the countdown restarts. */
  version: number;
  isLeaving: boolean;
};

export const EXIT_MS = 200;
const DURATION = {
  default: 4000,
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
  loading: Infinity,
} satisfies Record<ToastType, number>;

let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function set(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const getToasts = () => toasts;

function show(type: ToastType, title: ReactNode, options: ToastOptions = {}) {
  const { id = autoId(type, title, options.description), ...rest } = options;
  const fields = {
    type,
    title,
    description: rest.description,
    action: rest.action,
    expand: rest.expand,
    duration: rest.duration ?? DURATION[type],
  };
  const live = toasts.find((t) => t.id === id && !t.isLeaving);
  if (!live) {
    set([
      { id, ...fields, count: 1, version: 0, isLeaving: false },
      ...toasts.filter((t) => t.id !== id),
    ]);
    return id;
  }
  const isRepeat =
    live.type === type &&
    live.title === title &&
    live.description === rest.description;
  set(
    toasts.map((t) =>
      t === live
        ? {
            ...t,
            ...fields,
            count: isRepeat ? t.count + 1 : t.count,
            version: t.version + 1,
          }
        : t,
    ),
  );
  return id;
}

/** Identical string toasts share an id, so a repeat bumps the count instead of stacking a copy. */
function autoId(type: ToastType, title: ReactNode, description: ReactNode) {
  const isText =
    typeof title === 'string' &&
    (description === undefined || typeof description === 'string');
  return isText
    ? `${type}\u001f${title}\u001f${description ?? ''}`
    : `toast-${++nextId}`;
}

export function dismiss(id?: string) {
  const leaving = toasts.filter(
    (t) => !t.isLeaving && (id === undefined || t.id === id),
  );
  if (!leaving.length) return;
  set(toasts.map((t) => (leaving.includes(t) ? { ...t, isLeaving: true } : t)));
  setTimeout(
    () =>
      set(
        toasts.filter(
          (t) => !(t.isLeaving && leaving.some((l) => l.id === t.id)),
        ),
      ),
    EXIT_MS,
  );
}

type Message<T> = ReactNode | ((value: T) => ReactNode);
type PromiseMessages<T> = {
  loading: ReactNode;
  success: Message<T>;
  error: Message<unknown>;
};

function promise<T>(
  work: Promise<T>,
  messages: PromiseMessages<T>,
  options?: Omit<ToastOptions, 'id'>,
) {
  const id = show('loading', messages.loading, {
    ...options,
    id: `toast-${++nextId}`,
    duration: Infinity,
  });
  const text = <V>(message: Message<V>, value: V) =>
    typeof message === 'function' ? message(value) : message;
  work.then(
    (value) =>
      show('success', text(messages.success, value), { ...options, id }),
    (error: unknown) =>
      show('error', text(messages.error, error), { ...options, id }),
  );
  return work;
}

export const toast = Object.assign(
  (title: ReactNode, options?: ToastOptions) => show('default', title, options),
  {
    success: (title: ReactNode, options?: ToastOptions) =>
      show('success', title, options),
    info: (title: ReactNode, options?: ToastOptions) =>
      show('info', title, options),
    warning: (title: ReactNode, options?: ToastOptions) =>
      show('warning', title, options),
    error: (title: ReactNode, options?: ToastOptions) =>
      show('error', title, options),
    loading: (title: ReactNode, options?: ToastOptions) =>
      show('loading', title, options),
    promise,
    dismiss,
  },
);
