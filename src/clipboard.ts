import { toast } from 'sonner';

export function copyText(text: string, message: string) {
  navigator.clipboard.writeText(text).then(
    () => toast(message),
    () => toast.error('Could not copy to the clipboard'),
  );
}
