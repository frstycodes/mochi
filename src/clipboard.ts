import { toast } from './toast/store.ts';

export function copyText(text: string, message: string) {
  navigator.clipboard.writeText(text).then(
    () => toast(message),
    () => toast.error('Could not copy to the clipboard'),
  );
}
