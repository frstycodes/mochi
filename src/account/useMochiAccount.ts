import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import type { MochiAccount } from '../host/types/account';

/** Your Mochi account as main reports it, kept live, with the actions that change it. Null until main answers. */
export function useMochiAccount() {
  const [account, setAccount] = useState<MochiAccount | null>(null);
  useEffect(() => {
    let isLive = true;
    void host.account.get().then((a) => isLive && setAccount(a));
    const off = host.account.onChange(setAccount);
    return () => {
      isLive = false;
      off();
    };
  }, []);
  const signIn = () => host.account.signIn().catch((error: Error) => !/cancelled/.test(error.message) && toast.error(error.message));
  const signOut = () => host.account.signOut().catch((error: Error) => toast.error(`Signing out failed: ${error.message}`));
  return { account, signIn, signOut, cancelSignIn: () => host.account.cancelSignIn() };
}
