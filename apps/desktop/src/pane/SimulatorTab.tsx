import { useState, type FormEvent, type ReactNode } from 'react';
import { PaneActions, PaneTitle } from './PaneHeader';
import {
  Camera,
  XCircle,
  Code,
  Home,
  Link,
  LockKeyhole,
  Phone,
  Moon,
  Play,
  Power,
  Record,
  Stop,
  Sun,
  Tablet,
  Text,
  CheckCircle,
  X,
} from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { host } from '@/host';
import { threadCwd } from '@/host/cwd';
import {
  CONTENT_SIZES,
  type SimButton,
  type SimContentSize,
  type Simulator,
} from '@mochi/domain/host/types/sim';
import { cn } from '@/lib/utils';
import { DeviceScreen } from '@/sim/DeviceScreen';
import { useBuild, type BuildState } from '@/sim/useBuild';
import { useCapture } from '@/sim/useCapture';
import { useDeviceSettings } from '@/sim/useDeviceSettings';
import { message, useSimulators } from '@/sim/useSimulators';
import { usePrefs } from '@/settings/prefs';
import { useSimStream } from '@/sim/useSimStream';
import { toast } from '@/toast/store';
import type { PaneTabProps } from './tabs';
import { IconSwap } from '../ui';

export function SimulatorTab({ thread }: PaneTabProps) {
  const { simulators, error, refresh } = useSimulators();
  const [pickedUdid, setPickedUdid] = useState<string | null>(null);
  const { simulator } = usePrefs();
  const device =
    simulators?.find((s) => s.udid === (pickedUdid ?? simulator)) ??
    simulators?.find((s) => s.state === 'Booted') ??
    simulators?.[0] ??
    null;
  const isBooted = device?.state === 'Booted';
  const stream = useSimStream(isBooted ? device.udid : null);
  const settings = useDeviceSettings(isBooted ? device.udid : null);
  const { build, run, showLog, dismiss } = useBuild(
    device?.udid ?? null,
    thread,
  );
  const capture = useCapture(thread.id, isBooted ? device : null);
  const cwd = threadCwd(thread);

  if (error && !simulators) return <NoSimulatorsState error={error} />;
  if (!simulators) return <LoadingState label="Looking for simulators…" />;
  if (!device)
    return (
      <NoSimulatorsState error="No iPhone or iPad simulators are installed. Add one in Xcode › Settings › Components." />
    );

  const setPower = async (isOn: boolean) => {
    try {
      await (isOn
        ? host.sim.boot(device.udid)
        : host.sim.shutdown(device.udid));
    } catch (e) {
      toast.error(message(e));
    }
    refresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTitle>
        <DevicePicker
          simulators={simulators}
          value={device.udid}
          onChange={setPickedUdid}
        />
        <IconAction
          label={isBooted ? `Shut down ${device.name}` : `Boot ${device.name}`}
          onClick={() => setPower(!isBooted)}
        >
          <Power />
        </IconAction>
      </PaneTitle>
      <PaneActions>
        <IconAction
          label={
            settings.appearance === 'dark'
              ? 'Switch to light appearance'
              : 'Switch to dark appearance'
          }
          disabled={!isBooted}
          onClick={() =>
            settings.setAppearance(
              settings.appearance === 'dark' ? 'light' : 'dark',
            )
          }
        >
          <IconSwap id={settings.appearance === 'dark' ? 'dark' : 'light'}>
            {settings.appearance === 'dark' ? <Moon /> : <Sun />}
          </IconSwap>
        </IconAction>
        <ContentSizeMenu
          value={settings.contentSize}
          disabled={!isBooted}
          onChange={settings.setContentSize}
        />
        <DeepLinkPopover udid={device.udid} disabled={!isBooted} />
      </PaneActions>
      {!host.isDesktop && <MockNotice />}
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-3">
        {!isBooted && (
          <ShutDownState device={device} onBoot={() => setPower(true)} />
        )}
        {isBooted && !!stream.error && (
          <StreamErrorState error={stream.error} />
        )}
        {isBooted && !stream.error && (!stream.frameUrl || !stream.size) && (
          <LoadingState label="Starting the screen…" />
        )}
        {isBooted && !stream.error && !!stream.frameUrl && !!stream.size && (
          <DeviceScreen
            device={device}
            frameUrl={stream.frameUrl}
            size={stream.size}
          />
        )}
      </div>
      {!!build && (
        <BuildStatus build={build} onShowLog={showLog} onDismiss={dismiss} />
      )}
      <div className="flex h-11 shrink-0 items-center justify-center gap-1 px-2">
        <HardwareButton
          udid={device.udid}
          button="home"
          label="Home"
          disabled={!isBooted}
        >
          <Home />
        </HardwareButton>
        <HardwareButton
          udid={device.udid}
          button="lock"
          label="Lock"
          disabled={!isBooted}
        >
          <LockKeyhole />
        </HardwareButton>
        <IconAction
          label="Screenshot into the chat"
          disabled={!isBooted}
          onClick={capture.screenshot}
        >
          <Camera />
        </IconAction>
        <IconAction
          label={
            capture.isRecording
              ? 'Stop recording and post it'
              : 'Record the screen'
          }
          pressed={capture.isRecording}
          disabled={!isBooted}
          onClick={capture.toggleRecording}
        >
          <IconSwap id={capture.isRecording ? 'stop' : 'record'}>
            {capture.isRecording ? (
              <Stop className="text-destructive" />
            ) : (
              <Record />
            )}
          </IconSwap>
        </IconAction>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                variant="secondary"
                disabled={!isBooted || !cwd || build?.isBuilding}
                onClick={() => cwd && run(cwd)}
              >
                {build?.isBuilding ? <Spinner /> : <Play />}
                {build?.isBuilding ? 'Building…' : 'Build & run'}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {cwd
              ? "Build the project's first scheme and launch it here"
              : 'This thread has no project folder'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

const FAMILIES = [
  { family: 'iphone', label: 'iPhone', icon: Phone },
  { family: 'ipad', label: 'iPad', icon: Tablet },
] as const;

function DevicePicker({
  simulators,
  value,
  onChange,
}: {
  simulators: Simulator[];
  value: string;
  onChange: (udid: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-label="Simulator"
        className="-ml-2.5 max-w-56 min-w-0 border-transparent bg-transparent shadow-none dark:bg-transparent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {FAMILIES.map(({ family, label, icon: Icon }) => {
          const devices = simulators.filter((s) => s.family === family);
          return (
            devices.length > 0 && (
              <SelectGroup key={family}>
                <SelectLabel>{label}</SelectLabel>
                {devices.map((s) => (
                  <SelectItem key={s.udid} value={s.udid}>
                    <Icon aria-hidden />
                    <span className="truncate">{s.name}</span>
                    <span className="text-muted-foreground tabular-nums in-data-[slot=select-trigger]:hidden">
                      {s.runtime}
                    </span>
                    {s.state === 'Booted' && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-success in-data-[slot=select-trigger]:hidden"
                        aria-label="Booted"
                      />
                    )}
                  </SelectItem>
                ))}
              </SelectGroup>
            )
          );
        })}
      </SelectContent>
    </Select>
  );
}

// Xcode's own short names for content size categories (Environment Overrides).
const CONTENT_SIZE_LABELS = {
  'extra-small': 'XS',
  small: 'S',
  medium: 'M',
  large: 'L (default)',
  'extra-large': 'XL',
  'extra-extra-large': 'XXL',
  'extra-extra-extra-large': 'XXXL',
  'accessibility-medium': 'AX1',
  'accessibility-large': 'AX2',
  'accessibility-extra-large': 'AX3',
  'accessibility-extra-extra-large': 'AX4',
  'accessibility-extra-extra-extra-large': 'AX5',
} satisfies Record<SimContentSize, string>;

function ContentSizeMenu({
  value,
  disabled,
  onChange,
}: {
  value: SimContentSize | null;
  disabled: boolean;
  onChange: (size: SimContentSize) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dynamic Type size"
              disabled={disabled}
            >
              <Text />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Dynamic Type size</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Dynamic Type</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(v) =>
            onChange(CONTENT_SIZES.find((s) => s === v) ?? 'large')
          }
        >
          {CONTENT_SIZES.map((size) => (
            <DropdownMenuRadioItem key={size} value={size}>
              {CONTENT_SIZE_LABELS[size]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeepLinkPopover({
  udid,
  disabled,
}: {
  udid: string;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  const [isOpen, setOpen] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await host.sim.openUrl(udid, url.trim());
      setOpen(false);
    } catch (error) {
      toast.error(message(error));
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open a URL or deep link"
              disabled={disabled}
            >
              <Link />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Open a URL or deep link</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-2">
        <form onSubmit={submit}>
          <InputGroup>
            <InputGroupInput
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="myapp://path or https://…"
              aria-label="URL or deep link"
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" size="xs" disabled={!url.trim()}>
                Open
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function HardwareButton({
  udid,
  button,
  label,
  disabled,
  children,
}: {
  udid: string;
  button: SimButton;
  label: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <IconAction
      label={label}
      disabled={disabled}
      onClick={() =>
        host.sim.button(udid, button).catch((e) => toast.error(message(e)))
      }
    >
      {children}
    </IconAction>
  );
}

function IconAction({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(pressed && 'bg-accent text-foreground')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** One line while building or after: what it's doing (or how it ended) and a way into the full log in the Terminal tab. */
function BuildStatus({
  build,
  onShowLog,
  onDismiss,
}: {
  build: BuildState;
  onShowLog: () => void;
  onDismiss: () => void;
}) {
  const { isBuilding, lastLine, result } = build;
  const detail = result
    ? result.isOk
      ? `Launched ${result.bundleId}`
      : result.error
    : (lastLine ?? 'Starting…');
  return (
    <div
      role="status"
      className="mx-2 flex h-9 shrink-0 items-center gap-2 rounded-xl bg-card pr-1 pl-3 ring-1 ring-border"
    >
      {isBuilding && (
        <Spinner
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      {result?.isOk && (
        <CheckCircle aria-hidden className="size-3.5 shrink-0 text-success" />
      )}
      {result && !result.isOk && (
        <XCircle aria-hidden className="size-3.5 shrink-0 text-destructive" />
      )}
      <span className="shrink-0 type-meta text-foreground">
        {isBuilding ? 'Building' : result?.isOk ? 'Built' : 'Build failed'}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono type-caption text-muted-foreground"
        title={detail}
      >
        {detail}
      </span>
      <Button variant="ghost" size="xs" onClick={onShowLog}>
        <Code />
        Show log
      </Button>
      {!isBuilding && (
        <IconAction label="Dismiss" onClick={onDismiss}>
          <X />
        </IconAction>
      )}
    </div>
  );
}

function MockNotice() {
  return (
    <Alert className="mx-2 w-auto">
      <AlertDescription>
        Mock device. The live simulator needs the Mochi desktop app on a Mac
        with Xcode.
      </AlertDescription>
    </Alert>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="type-meta flex h-full items-center justify-center gap-2 text-muted-foreground"
    >
      <Spinner />
      {label}
    </div>
  );
}

function NoSimulatorsState({ error }: { error: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Phone />
        </EmptyMedia>
        <EmptyTitle>No simulators</EmptyTitle>
        <EmptyDescription>{error}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ShutDownState({
  device,
  onBoot,
}: {
  device: Simulator;
  onBoot: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {device.family === 'ipad' ? <Tablet /> : <Phone />}
        </EmptyMedia>
        <EmptyTitle>{device.name} is shut down</EmptyTitle>
        <EmptyDescription>{device.runtime}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onBoot}>
          <Power />
          Boot
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function StreamErrorState({ error }: { error: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Can't show the screen</EmptyTitle>
        <EmptyDescription>{error}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
