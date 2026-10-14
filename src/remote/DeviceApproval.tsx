import { useEffect, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { host } from '../host';
import type { ApprovalRequest } from '../host/types/remote';
import { PairingCode } from './PairingCode';

/** "Allow <device>?" when a device of yours pairs through the relay. Unanswered by its deadline, it closes as No in main too. */
export function DeviceApprovalLayer() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  useEffect(() => host.remote.onApproval((request) => setRequests((all) => [...all, request])), []);
  const request = requests[0];
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => setRequests((all) => all.slice(1)), Math.max(0, request.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [request]);
  const answer = (isAllowed: boolean) => {
    if (!request) return;
    void host.remote.answerApproval(request.id, isAllowed);
    setRequests((all) => all.slice(1));
  };
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && answer(false)}>
      {!!request && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow “{request.name}” to control this computer?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <p>It will follow and steer the threads here. Allow it only if “{request.name}” shows this code:</p>
                <PairingCode code={request.pairingCode} />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Don’t allow</AlertDialogCancel>
            <AlertDialogAction onClick={() => answer(true)}>Allow</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
