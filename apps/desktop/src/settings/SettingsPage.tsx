import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessagePlus } from '@/icons';
import {
  MachineSettings,
  SettingsComputerPicker,
} from '../remote/MachineSettings';
import { SharedSettingsNotice } from '../remote/SharedSettingsNotice';
import { useMachines } from '../remote/useMachines';
import { useHarness } from '../store';
import { TitleBar } from '../TitleBar';
import type { SettingsRoute } from '../routes/locations';
import { useEscapeBack, useSettingsRoute } from '../routes/nav';
import { prefersReducedMotion } from './prefs';
import { SettingsChat, settingsChatOf } from './SettingsChat';
import { SETTINGS_SECTIONS, type SettingsSection } from './sections';

/** The content column while settings are open: one page under its title, scrolling on its own. */
export function SettingsPage() {
  const route = useSettingsRoute();
  const section =
    SETTINGS_SECTIONS.find((s) => s.id === route?.section) ??
    SETTINGS_SECTIONS[0];
  const Section = section.component;
  const Subpage = route?.subpage
    ? (section as SettingsSection).subpage
    : undefined;
  const [machineId, setMachineId] = useState<string | null>(null);
  const machine = useMachines().machines.find(
    (m) => m.machine.id === machineId,
  )?.machine;
  useEscapeBack();
  useFlashSetting(route);
  if (section.id === 'chat') return <SettingsChatPage />;

  return (
    // Grid, not flex: the scroll viewport's height: 100% only resolves against a definite grid track. The column is
    // minmax(0, 1fr) so truncated text can't widen the page past a phone screen.
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <TitleBar className="px-4">
        <span className="flex-1" />
        <SettingsComputerPicker
          value={machine ? machineId : null}
          onChange={setMachineId}
        />
      </TitleBar>
      <ScrollArea type="scroll" className="min-h-0">
        <div className="mx-auto flex w-full max-w-180 flex-col gap-8 px-4 pt-6 pb-16 md:px-8">
          {!Subpage && <h1 className="px-1 type-display">{section.title}</h1>}
          {machine ? (
            <MachineSettings
              key={machine.id}
              machine={machine}
              section={section.id}
            />
          ) : Subpage ? (
            <Subpage key={route!.subpage} id={route!.subpage!} />
          ) : (
            <>
              <SharedSettingsNotice />
              <Section />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** The chat fills the column and scrolls itself; it is this computer's only, so no computer picker. */
function SettingsChatPage() {
  const { state, dispatch } = useHarness();
  const thread = settingsChatOf(state);
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <TitleBar className="px-4">
        <span className="flex-1" />
        {!!thread && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'delete', threadIds: [thread.id] })}
          >
            <MessagePlus aria-hidden />
            New chat
          </Button>
        )}
      </TitleBar>
      <div className="flex min-h-0 flex-col">
        <SettingsChat />
      </div>
    </div>
  );
}

const FLASH_MS = 1200;

/** Deep links scroll to their row and flash it; rows that wait on loaded settings get a few frames to appear. */
function useFlashSetting(route: SettingsRoute | null) {
  useEffect(() => {
    if (!route?.settingId) return;
    let frame = 0;
    let timer = 0;
    const startedAt = performance.now();
    const find = () => {
      const row = document.querySelector<HTMLElement>(
        `[data-setting-id="${route.settingId}"]`,
      );
      if (!row) {
        if (performance.now() - startedAt < 2000)
          frame = requestAnimationFrame(find);
        return;
      }
      const smooth = !prefersReducedMotion();
      row.scrollIntoView({
        block: 'center',
        behavior: smooth ? 'smooth' : 'auto',
      });
      row.dataset.flash = '';
      timer = window.setTimeout(() => delete row.dataset.flash, FLASH_MS);
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `nonce` re-runs it when the same setting is deep-linked twice
  }, [route?.nonce, route?.settingId]);
}
