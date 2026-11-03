import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SpaceIcon } from '../../ui';
import { Block, Section } from '../layout';
import { useProfileLibrary } from './profile-library/model';
import { CompareVariant } from './profile-library/variant-compare';
import { ItemFirstVariant } from './profile-library/variant-items';
import { PaletteVariant } from './profile-library/variant-palette';
import { ProfileFirstVariant } from './profile-library/variant-profile';

/** Four ways to manage what each profile loads, on one fixture state, so a change in one variant shows in the others. */
export function ProfileLibrarySection() {
  const lib = useProfileLibrary();
  const [currentId, setCurrentId] = useState('work');
  const [width, setWidth] = useState('wide');
  const isNarrow = width === 'narrow';
  const shared = { lib, isNarrow };
  return (
    <Section
      id="profile-library"
      title="Profiles: library variants"
      intro="Mockups on fixture data for managing skills, plugins and connectors per profile. Mochi’s items are added to profiles; Claude Code’s and Codex’s own are on until turned off in Mochi only (PROFILES-UX.md). Every change has an undo toast."
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Control label="You’re in">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={currentId}
            onValueChange={(v) => v && setCurrentId(v)}
            aria-label="Profile you’re in"
          >
            {lib.profiles.slice(0, 3).map((p) => (
              <ToggleGroupItem key={p.id} value={p.id}>
                <SpaceIcon space={p} className="size-3.5" />
                {p.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Control>
        <Control label="Data">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={lib.isFirstRun ? 'first' : 'setup'}
            onValueChange={(v) => v && lib.setFirstRun(v === 'first')}
            aria-label="Data"
          >
            <ToggleGroupItem value="setup">Your setup</ToggleGroupItem>
            <ToggleGroupItem value="first">First run</ToggleGroupItem>
          </ToggleGroup>
        </Control>
        <Control label="Width">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={width}
            onValueChange={(v) => v && setWidth(v)}
            aria-label="Width"
          >
            <ToggleGroupItem value="wide">Settings page</ToggleGroupItem>
            <ToggleGroupItem value="narrow">375px</ToggleGroupItem>
          </ToggleGroup>
        </Control>
      </div>
      <div className="flex flex-col gap-12">
        <Block
          title="A · Profile first"
          use="Settings › Profiles › <profile>. Everything one profile loads, by kind, with Add from library (to this profile and others at once), copy from another profile, and remove in place."
        >
          <ProfileFirstVariant {...shared} />
        </Block>
        <Block
          title="B · Item first, improved"
          use="Settings › Skills, Plugins, Connectors without the page-wide profile picker. Each row names the profiles that load it and edits them in one multi-select; the same button for Mochi and native items."
        >
          <ItemFirstVariant {...shared} currentId={currentId} />
        </Block>
        <Block
          title="C · Palette"
          use="A Raycast-style surface (⌘⇧L anywhere, inline here): find anything in the library, Enter toggles it in the target profile, Tab changes the target, ⌘1–3 toggle a profile directly."
        >
          <PaletteVariant key={currentId} {...shared} currentId={currentId} />
        </Block>
        <Block
          title="D · Compare"
          use="Items × profiles. Spot differences, copy one profile’s set into another, start a new profile from one. A row per connector account. Two columns, picked at the top, at narrow widths."
        >
          <CompareVariant {...shared} />
        </Block>
      </div>
    </Section>
  );
}

function Control({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="type-meta text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
