import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SPACE_ICON_NAMES, type Space } from './model';
import { updateProfile } from './profiles';
import { openSubpage } from './routes/nav';
import {
  HaloMotionPicker,
  IconPicker,
  SpaceColorPicker,
} from './settings/sections/profiles';
import {
  HALO_KNOB_KEYS,
  HALO_KNOBS,
  haloKnob,
  haloMotion,
  isHaloMotion,
  type HaloKnob,
} from './haloShape';
import { Slider } from '@/components/ui/slider';
import { isSpaceColor, spaceColor } from './spaceColor';

/** The profile's name, icon and halo (colour, motion, reach, raggedness, intensity), edited in place from the sidebar like Arc's space editor; the rest stays in Settings. */
export function SpaceEditor({ space }: { space: Space }) {
  return (
    <div className="flex w-72 flex-col gap-4">
      <NameField space={space} />
      <Field>
        <FieldLabel htmlFor="space-editor-icon">Icon</FieldLabel>
        <IconPicker
          id="space-editor-icon"
          value={space.icon}
          onChange={(icon) => {
            const name = SPACE_ICON_NAMES.find((n) => n === icon);
            if (name) updateProfile(space.id, { icon: name });
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="space-editor-color">Color</FieldLabel>
        <SpaceColorPicker
          id="space-editor-color"
          value={spaceColor(space)}
          onChange={(color) => {
            if (isSpaceColor(color)) updateProfile(space.id, { color });
          }}
        />
      </Field>
      {spaceColor(space) !== 'none' && (
        <Field>
          <FieldLabel htmlFor="space-editor-motion">Motion</FieldLabel>
          <HaloMotionPicker
            id="space-editor-motion"
            value={haloMotion(space)}
            onChange={(motion) => {
              if (isHaloMotion(motion))
                updateProfile(space.id, { haloMotion: motion });
            }}
          />
        </Field>
      )}
      {spaceColor(space) !== 'none' &&
        HALO_KNOB_KEYS.map((knob) => (
          <KnobField key={knob} space={space} knob={knob} />
        ))}
      <Button
        variant="ghost"
        size="xs"
        className="self-start text-muted-foreground"
        onClick={() => openSubpage('profiles', space.id)}
      >
        All profile settings
      </Button>
    </div>
  );
}

// Saves per step while dragging, so the halo follows the thumb; a few dozen values at most per drag.
function KnobField({ space, knob }: { space: Space; knob: HaloKnob }) {
  const { label, min, max, step } = HALO_KNOBS[knob];
  const value = haloKnob(space, knob);
  const id = `space-editor-${knob}`;
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span className="type-caption text-muted-foreground tabular-nums">
          {value}%
        </span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) =>
          next !== value && updateProfile(space.id, { [knob]: next })
        }
      />
    </Field>
  );
}

// Saves on Enter or blur, never per keystroke; an empty name puts the old one back.
function NameField({ space }: { space: Space }) {
  const [name, setName] = useState(space.name);
  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return setName(space.name);
    if (trimmed !== space.name) updateProfile(space.id, { name: trimmed });
  };
  return (
    <Field>
      <FieldLabel htmlFor="space-editor-name">Name</FieldLabel>
      <Input
        id="space-editor-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </Field>
  );
}
