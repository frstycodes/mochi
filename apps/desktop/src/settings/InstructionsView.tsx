import { useProfiles } from '../profiles';
import { useHarnessSelector } from '../store';
import { ScopePicker } from '../library/LibraryPage';
import { useLibraryScope } from '../library/libraryScope';
import { AccountInstructions } from './AccountInstructions';
import { ProfileInstructions } from './ProfileInstructions';

/**
 * Settings › Instructions: what a profile's new threads are told. Mochi's own files for the profile come first, then
 * your CLAUDE.md and AGENTS.md, which each profile can keep or leave out. The profile is picked as on Skills.
 */
export function InstructionsView() {
  const profiles = useProfiles();
  const scope = useLibraryScope();
  const spaceId = useHarnessSelector((s) => s.spaceId);
  // Skills, Plugins and Connectors can be on All profiles; instructions are always one profile's.
  const profile =
    scope.profile ?? profiles.find((p) => p.id === spaceId) ?? profiles[0];
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="type-meta text-pretty text-muted-foreground">
          Written once per profile and added to every new thread in it. Mochi’s
          files are yours to edit here; your own CLAUDE.md and AGENTS.md can be
          kept or left out of the profile.
        </p>
        <ScopePicker hasAll={false} />
      </div>
      <ProfileInstructions profile={profile} />
      <AccountInstructions profile={profile} />
    </div>
  );
}
