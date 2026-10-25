import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { toast } from '../toast/store.ts';
import { host } from '../host';

/** Your Mochi account as main reports it, kept live, with the actions that change it. Null until main answers. */
export function useMochiAccount() {
  const accountQuery = useQuery({
    queryKey: queryKeys.account(),
    queryFn: () => host.account.get(),
  });
  const account = accountQuery.data ?? null;
  useEffect(
    () =>
      host.account.onChange(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.account() });
      }),
    [],
  );
  const signIn = () =>
    host.account
      .signIn()
      .catch(
        (error: Error) =>
          !/cancelled/.test(error.message) && toast.error(error.message),
      );
  const signOut = () =>
    host.account
      .signOut()
      .catch((error: Error) =>
        toast.error(`Signing out failed: ${error.message}`),
      );
  const openAccountPortal = () =>
    host.account
      .openAccountPortal()
      .catch((error: Error) => toast.error(error.message));
  return {
    account,
    signIn,
    signOut,
    openAccountPortal,
    cancelSignIn: () => host.account.cancelSignIn(),
  };
}
