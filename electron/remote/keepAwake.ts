import { powerSaveBlocker } from 'electron';

let blocker: number | undefined;

/** 'prevent-app-suspension' stops idle sleep (the display may still turn off). GAP: closing a laptop's lid or choosing Sleep still sleeps it. */
export function holdAwake(isHeld: boolean) {
  if (isHeld === (blocker !== undefined)) return;
  if (isHeld) blocker = powerSaveBlocker.start('prevent-app-suspension');
  else {
    powerSaveBlocker.stop(blocker!);
    blocker = undefined;
  }
}
