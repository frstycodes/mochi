import { statSync } from 'node:fs';
import {
  libraryEntries,
  removeItem,
  setItemEnabled,
  type SkillDestination,
} from '../../../../apps/desktop/src/library/library.ts';
import type { LibraryHost } from '../../../../apps/desktop/src/host/types/library.ts';
import type { HostMethods } from '../hostMethods.ts';
import { RELAY_URL } from '../remote/relayClient.ts';
import { discoverSkills, fetchMarketplace } from './catalog.ts';
import { popularSkillsSh, searchSkillsSh } from './skillsSh.ts';
import {
  addMarketplace,
  addOwnSkill,
  importFromAccount,
  installPlugin,
  installSkill,
  installUploadedPlugin,
  marketplaces,
  readLibrary,
  removeMarketplace,
  removePlacements,
  renameConnector,
  reviewUploadedPlugin,
  updateLibrary,
  withSettings,
} from './store.ts';
import { setAutoUpdate, updateItem } from './updates.ts';

/**
 * Main keeps connector accounts' live side: their sign-in (the system browser, its loopback OAuth callback and the dialog's
 * device code), the clients and tool proxy on its MCP server, their `safeStorage` secrets, and setup runs in the browser pane.
 */
export type InMain =
  | 'addConnector'
  | 'signIn'
  | 'oauthApps'
  | 'runSetup'
  | 'updateSetupStep'
  | 'listConnectorTools';

/** `host.library`: skills, plugins, marketplaces and the connectors' index, kept in Core's `library` table and userData/library. */
export const libraryHost = (
  /** Drops a connector account's sign-in and secrets where main keeps them; nothing to drop when main isn't connected. */
  forgetConnector: (id: string) => Promise<void>,
) =>
  ({
    async list(_caller, spaceId) {
      return libraryEntries(await readLibrary(), spaceId);
    },
    async setEnabled(_caller, spaceId, id, isEnabled) {
      return libraryEntries(
        await updateLibrary((index) =>
          setItemEnabled(index, spaceId, id, isEnabled),
        ),
        spaceId,
      );
    },
    async remove(_caller, spaceId, id) {
      const item = (await readLibrary()).items.find((i) => i.id === id);
      if (item?.kind === 'connector') await forgetConnector(id);
      await removePlacements(item);
      return libraryEntries(
        await updateLibrary((index) => removeItem(index, id)),
        spaceId,
      );
    },
    async importFromAccount(_caller, spaceId, provider, parts, names) {
      const notes = await importFromAccount(spaceId, provider, parts, names);
      return { entries: libraryEntries(await readLibrary(), spaceId), notes };
    },
    async addSkill(_caller, spaceId, files) {
      await addOwnSkill(spaceId, files);
      return libraryEntries(await readLibrary(), spaceId);
    },
    async discoverSkills(_caller, source) {
      const skills = await discoverSkills(source);
      return skills.map(
        ({ name, description, source: from, files, icon, commit }) => ({
          name,
          description,
          source: from,
          fileCount: Object.keys(files).length,
          icon,
          commit,
        }),
      );
    },
    async skillFiles(_caller, source, name) {
      const skill = (await discoverSkills(source)).find((s) => s.name === name);
      if (!skill) throw new Error(`${name} isn't in ${source}`);
      return skill.files;
    },
    async installSkill(_caller, spaceId, source, name, destination) {
      await installSkill(spaceId, source, name, skillDestination(destination));
      return libraryEntries(await readLibrary(), spaceId);
    },
    async searchSkillsSh(_caller, query) {
      return searchSkillsSh(query);
    },
    async popularSkillsSh() {
      return popularSkillsSh();
    },
    async marketplaces() {
      return marketplaces();
    },
    async addMarketplace(_caller, source) {
      await addMarketplace(source);
      return marketplaces();
    },
    async removeMarketplace(_caller, name) {
      await removeMarketplace(name);
      return marketplaces();
    },
    async marketplaceCatalog(_caller, name) {
      const marketplace = (await marketplaces()).find((m) => m.name === name);
      if (!marketplace) throw new Error(`No marketplace named ${name}`);
      return fetchMarketplace(marketplace.source);
    },
    async installPlugin(_caller, spaceId, marketplace, name) {
      await installPlugin(spaceId, marketplace, name);
      return libraryEntries(await readLibrary(), spaceId);
    },
    async reviewUpload(_caller, file) {
      return reviewUploadedPlugin(file.name, file.bytes);
    },
    async installUpload(_caller, spaceId, file, choice) {
      await installUploadedPlugin(
        file.name,
        file.bytes,
        choice.sha256,
        choice.targets,
        choice.profileIds,
      );
      return libraryEntries(await readLibrary(), spaceId);
    },
    async ownAppRedirect() {
      return `${RELAY_URL}/oauth/callback`;
    },
    async update(_caller, spaceId, id, autoUpdate) {
      if (autoUpdate === undefined) await updateItem(id);
      else await setAutoUpdate(id, autoUpdate);
      return libraryEntries(await readLibrary(), spaceId);
    },
    async renameConnector(_caller, spaceId, key, name) {
      await renameConnector(key, name.trim());
      return libraryEntries(await readLibrary(), spaceId);
    },
    async connectorSettings() {
      return (await readLibrary()).connectors ?? {};
    },
    async setConnectorSettings(_caller, key, settings) {
      const chosen = {
        ...(settings.isOff === true && { isOff: true }),
        tools: settings.tools ?? {},
      };
      const index = await updateLibrary((current) =>
        withSettings(current, key, ({ toolList }) => ({
          ...chosen,
          ...(toolList && { toolList }),
        })),
      );
      return index.connectors ?? {};
    },
  }) satisfies HostMethods<Omit<LibraryHost, InMain>>;

// GAP: a project path is checked to be an existing folder, not that it is one of the profile's projects.
function skillDestination(
  input: SkillDestination | undefined,
): SkillDestination | undefined {
  if (!input || input.scope === 'library') return input;
  const providers = [...new Set(input.providers)];
  if (input.scope === 'user') return { scope: 'user', providers };
  if (!statSync(input.project, { throwIfNoEntry: false })?.isDirectory())
    throw new TypeError('destination.project must be a project folder');
  return { scope: 'project', providers, project: input.project };
}
