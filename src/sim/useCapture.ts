import { useState } from 'react';
import { toast } from '@/toast/store';
import { host } from '@/host';
import type { Simulator } from '@/host/types/sim';
import { useHarness } from '@/store';
import { message } from './useSimulators';

/** Screenshot and screen recording of a device, posted to the thread like a browser comment. */
export function useCapture(threadId: string, device: Simulator | null) {
  const { dispatch } = useHarness();
  const [isRecording, setRecording] = useState(false);

  // GAP: chat entries are text only, so the capture goes in as its file path until messages carry attachments.
  const post = (what: string, path: string) => dispatch({ type: 'say', threadId, entry: { who: 'you', kind: 'message', text: `${what} of ${device?.name}: ${path}` } });

  const screenshot = async () => {
    if (!device) return;
    try {
      post('Simulator screenshot', await host.sim.screenshot(device.udid));
    } catch (e) {
      toast.error(message(e));
    }
  };

  const toggleRecording = async () => {
    if (!device) return;
    try {
      if (!isRecording) {
        await host.sim.startRecording(device.udid);
        setRecording(true);
        return;
      }
      setRecording(false);
      post('Simulator recording', await host.sim.stopRecording(device.udid));
    } catch (e) {
      setRecording(false);
      toast.error(message(e));
    }
  };

  return { isRecording, screenshot, toggleRecording };
}
