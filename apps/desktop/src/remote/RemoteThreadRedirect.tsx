import { useLayoutEffect } from 'react';
import { goHome, useRemoteThreadLink } from '../routes/nav';
import { useDispatch } from '../store';

/** `/remote/$machineId/$threadId` (the sidebar, an alert, a deep link): opens that thread in the focused split, then leaves. */
export function RemoteThreadRedirect() {
  const link = useRemoteThreadLink();
  const dispatch = useDispatch();
  useLayoutEffect(() => {
    if (link)
      dispatch({ type: 'go', view: { kind: 'thread', id: link.threadId } });
    goHome();
  }, [link, dispatch]);
  return null;
}
