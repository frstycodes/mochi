import { toast } from './toast/store.ts';

export function copyText(
  text: string,
  message: string,
  failure = 'Could not copy to the clipboard',
) {
  navigator.clipboard.writeText(text).then(
    () => toast(message),
    () => toast.error(failure),
  );
}
