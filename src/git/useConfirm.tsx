import { useCallback, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmRequest {
  title: string;
  description: ReactNode;
  confirm: string;
  cancel: string;
  isDestructive?: boolean;
}

/** `await confirm({...})` resolves true only when the user picks the confirm action; render `dialog` once. */
export function useConfirm() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((r: ConfirmRequest) => new Promise<boolean>((resolve) => setRequest({ ...r, resolve })), []);
  const settle = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  const dialog = (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && settle(false)}>
      {!!request && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{request.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>{request.description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{request.cancel}</AlertDialogCancel>
            <AlertDialogAction variant={request.isDestructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
              {request.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );

  return { confirm, dialog };
}
