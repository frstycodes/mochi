import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useMochiAccount } from '../../account/useMochiAccount';
import { host } from '../../host';
import type { MochiUser } from '../../host/types/account';
import { DesktopOnlyNotice, SettingsGroup, SettingsRow } from '../parts';

const ABOUT = "Your Mochi account links your computers so each can follow and steer the others' threads. It isn't your Claude or Codex login: Mochi never signs in to those or sees their credentials.";

export function AccountSection() {
  const { account, signIn, signOut, cancelSignIn } = useMochiAccount();
  if (!host.isDesktop) return <DesktopOnlyNotice what="Signing in to a Mochi account happens in the desktop app, which keeps the session in your keychain." />;
  if (!account) return null;
  const isSessionOnly = account.status === 'signed-in' && !account.isPersistent;
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="mochiAccount" footer={isSessionOnly ? `${ABOUT} This computer has no secret store, so you'll sign in again after Mochi quits.` : ABOUT}>
        {account.status === 'unconfigured' && <SettingsRow label="Sign-in isn't set up in this build" description="Needs the Clerk app's issuer and client id (MOCHI_CLERK_ISSUER, MOCHI_CLERK_CLIENT_ID)." />}
        {account.status === 'signed-out' && <SettingsRow label="Not signed in" description="Signing in opens your browser." control={<Button size="sm" onClick={() => void signIn()}>Sign in</Button>} />}
        {account.status === 'signing-in' && (
          <SettingsRow
            label={
              <span className="flex items-center gap-2">
                <Spinner className="size-3.5" />
                Finish signing in in your browser
              </span>
            }
            description="Mochi picks it up as soon as you're done."
            control={
              <Button size="sm" variant="outline" onClick={() => void cancelSignIn()}>
                Cancel
              </Button>
            }
          />
        )}
        {account.status === 'signed-in' && !!account.user && (
          <SettingsRow
            label={<SignedInUser user={account.user} />}
            control={
              <Button size="sm" variant="outline" onClick={() => void signOut()}>
                Sign out
              </Button>
            }
          />
        )}
      </SettingsGroup>
    </div>
  );
}

function SignedInUser({ user }: { user: MochiUser }) {
  const shown = user.name ?? user.email ?? 'Signed in';
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-7">
        {!!user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
        <AvatarFallback className="type-caption">{shown.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        <span className="truncate type-body">{shown}</span>
        {!!user.email && user.email !== shown && <span className="truncate type-meta text-muted-foreground">{user.email}</span>}
      </span>
    </span>
  );
}
