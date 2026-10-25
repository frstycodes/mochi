import { host } from './host';

// Desktop: NSHapticFeedbackManager's alignment tick on a Force Touch trackpad (electron/haptics). Web: a short vibration on phones.
export function haptic() {
  void host.notify.haptic().catch(() => {});
}
