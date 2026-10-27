import { Button } from '@/components/ui/button';
import { host } from '../../host';
import { SettingsChoice, SettingsGroup, SettingsRow } from '../parts';
import { useUpdates } from '../../updates/useUpdates';
import pkg from '../../../package.json';

export function AboutSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup title="Versions">
        <SettingsRow label="Mochi" control={<Version>{pkg.version}</Version>} />
        {host.isDesktop && (
          <SettingsRow
            label="Electron"
            control={<Version>{engineVersion('Electron')}</Version>}
          />
        )}
        <SettingsRow
          label="Chromium"
          control={
            <Version>{engineVersion('Chrome') || 'Not Chromium'}</Version>
          }
        />
      </SettingsGroup>
      {host.isDesktop && <UpdatesGroup />}
      <SettingsGroup title="Docs">
        {DOCS.map((d) => (
          <SettingsRow
            key={d.href}
            label={d.label}
            description={d.what}
            control={
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="type-meta underline underline-offset-4"
              >
                Open
              </a>
            }
          />
        ))}
      </SettingsGroup>
    </div>
  );
}

function UpdatesGroup() {
  const { state, summary, action, setChannel } = useUpdates();
  if (!state) return null;
  return (
    <SettingsGroup title="Updates">
      <SettingsRow
        label="Release channel"
        description="Stable follows tagged releases; Nightly is built from main every day"
        control={
          <SettingsChoice
            id="releaseChannel"
            aria-label="Release channel"
            value={state.channel}
            options={CHANNELS}
            onChange={(channel) => void setChannel(channel)}
          />
        }
      />
      <SettingsRow
        label={`Mochi ${state.version}`}
        description={summary}
        control={
          !!action && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void action.run()}
            >
              {action.label}
            </Button>
          )
        }
      />
    </SettingsGroup>
  );
}

const CHANNELS = [
  { value: 'stable', label: 'Stable' },
  { value: 'nightly', label: 'Nightly' },
] as const;

function Version({ children }: { children: string }) {
  return (
    <span className="type-meta text-muted-foreground tabular">{children}</span>
  );
}

const REPO = 'https://github.com/frstycodes/mochi/blob/main';
const DOCS = [
  {
    label: 'README',
    what: 'What Mochi is and how to run it',
    href: `${REPO}/README.md`,
  },
  {
    label: 'Runtime',
    what: 'How threads, agents and tools work',
    href: `${REPO}/RUNTIME.md`,
  },
  {
    label: 'Settings',
    what: 'Every setting and where it lives',
    href: `${REPO}/SETTINGS.md`,
  },
];

function engineVersion(name: string) {
  return navigator.userAgent.match(new RegExp(`${name}/([\\d.]+)`))?.[1] ?? '';
}
