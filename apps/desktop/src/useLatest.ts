import { useLayoutEffect, useRef } from 'react';

/** `value` as of the last commit, for async code and handlers that outlive the render they were made in. Effects that only read it want `useEffectEvent`. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
