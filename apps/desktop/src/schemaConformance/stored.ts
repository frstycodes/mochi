import type * as Stored from '../../../../packages/schema/src/stored.ts';
import type { Pin, Pins } from '../chat/pins.ts';
import type {
  Project,
  ProjectIconMode,
} from '@mochi/domain/host/types/projects';
import type { Space } from '../model.ts';
import type { Prefs } from '../settings/prefs.ts';
import type { ToolPolicy } from '../runtime/toolPolicy.ts';
import type { ColorTheme } from '@mochi/domain/themes/model';
import type { Schema } from 'effect';
import type { Check, Decoded, Same } from './check.ts';

/** The schema package doesn't list tool names, so `toolPolicies` is a string-keyed record there. */
type SchemaPrefs = Omit<Prefs, 'toolPolicies'> & {
  toolPolicies: Record<string, ToolPolicy>;
};
type Row<T> = T & { v: 1 };
/** A versioned row's current version: `members[1]` is the same type reached through the legacy upgrade. */
type Current<S extends { members: readonly [Schema.Top, ...unknown[]] }> =
  Decoded<S['members'][0]>;

type StoredPrefs = Partial<SchemaPrefs>;
type StoredProject = Omit<
  Project,
  'isMissing' | 'icon' | 'iconMode' | 'favicon' | 'favoriteOrder'
> & { iconMode?: ProjectIconMode; favoriteOrder?: number };

export type RowsCarryV = Check<
  Current<typeof Stored.Pin> extends Row<Pin> ? true : false
>;

// `Stored` in src/host/web/themes.ts and `StoredProject` in electron/projects/registry.ts aren't exported: restated here.
export type Conformance = [
  Check<Same<Current<typeof Stored.Pin>, Pin>>,
  Check<Same<{ [id: string]: Current<typeof Stored.Pin>[] }, Pins>>,
  Check<Same<Current<typeof Stored.Profile>, Space>>,
  Check<Same<Current<typeof Stored.StoredPrefs>, StoredPrefs>>,
  Check<
    Same<
      Current<typeof Stored.StoredThemes>,
      { installed: ColorTheme[]; custom: Record<string, string> }
    >
  >,
  Check<Same<Current<typeof Stored.StoredProject>, StoredProject>>,
  Check<
    Same<Decoded<typeof Stored.LegacyProjectRecents>, Record<string, string[]>>
  >,
  Check<Same<Decoded<typeof Stored.Prefs>, SchemaPrefs>>,
];
