import type * as AccountS from '../../packages/schema/src/ipc/account.ts';
import type * as BrowserS from '../../packages/schema/src/ipc/browser.ts';
import type * as DataS from '../../packages/schema/src/ipc/data.ts';
import type * as FsS from '../../packages/schema/src/ipc/fs.ts';
import type * as GitS from '../../packages/schema/src/ipc/git.ts';
import type * as LibraryS from '../../packages/schema/src/ipc/library.ts';
import type * as NotifyS from '../../packages/schema/src/ipc/notify.ts';
import type * as PortsS from '../../packages/schema/src/ipc/ports.ts';
import type * as PtyS from '../../packages/schema/src/ipc/pty.ts';
import type * as Account from '../host/types/account.ts';
import type * as Browser from '../host/types/browser.ts';
import type * as Data from '../host/types/data.ts';
import type * as Fs from '../host/types/fs.ts';
import type * as Git from '../host/types/git.ts';
import type * as Library from '../host/types/library.ts';
import type * as Notify from '../host/types/notify.ts';
import type * as Ports from '../host/types/ports.ts';
import type * as Pty from '../host/types/pty.ts';
import type { RefState, GithubRef } from '../chat/refs.ts';
import type { LibraryEntry, PluginReview, SkillDestination } from '../library/library.ts';
import type { ConnectorSettings } from '../library/connectorTools.ts';
import type { SetupResult, SetupTarget } from '../library/recipes.ts';
import type { QuietHours } from '../notify/model.ts';
import type { Check, Decoded, Rpc, Same } from './check.ts';

export type Conformance = [
  Check<Rpc<Account.AccountHost, typeof AccountS.accountRpc>>,
  Check<Rpc<Browser.BrowserHost, typeof BrowserS.browserRpc>>,
  Check<Rpc<Data.DataHost, typeof DataS.dataRpc>>,
  Check<Rpc<Fs.FsHost, typeof FsS.fsRpc>>,
  Check<Rpc<Git.GitHost, typeof GitS.gitRpc>>,
  Check<Rpc<Library.LibraryHost, typeof LibraryS.libraryRpc>>,
  Check<Rpc<Notify.NotifyHost, typeof NotifyS.notifyRpc>>,
  Check<Rpc<Ports.PortsHost, typeof PortsS.portsRpc>>,
  Check<Rpc<Pty.PtyHost, typeof PtyS.ptyRpc>>,
  Check<Same<Decoded<typeof BrowserS.BrowserEvent>, Browser.BrowserEvent>>,
  Check<Same<Decoded<typeof BrowserS.BrowserAct>, Browser.BrowserAct>>,
  Check<Same<Decoded<typeof GitS.GitDiff>, Git.GitDiff>>,
  Check<Same<Decoded<typeof GitS.ChangeTarget>, Git.ChangeTarget>>,
  Check<Same<Decoded<typeof GitS.DiffScope>, Git.DiffScope>>,
  Check<Same<Decoded<typeof GitS.PrReview>, Git.PrReview>>,
  Check<Same<Decoded<typeof GitS.RefState>, RefState>>,
  Check<Same<Decoded<typeof GitS.GithubRef>, GithubRef>>,
  Check<Same<Decoded<typeof FsS.FileContent>, Fs.FileContent>>,
  Check<Same<Decoded<typeof LibraryS.LibraryEntry>, LibraryEntry>>,
  Check<Same<Decoded<typeof LibraryS.PluginReview>, PluginReview>>,
  Check<Same<Decoded<typeof LibraryS.SkillDestination>, SkillDestination>>,
  Check<Same<Decoded<typeof LibraryS.ConnectorSettings>, ConnectorSettings>>,
  Check<Same<Decoded<typeof LibraryS.SetupResult>, SetupResult>>,
  Check<Same<Decoded<typeof LibraryS.SetupTarget>, SetupTarget>>,
  Check<Same<Decoded<typeof NotifyS.WatchConfig>, Notify.WatchConfig>>,
  Check<Same<Decoded<typeof NotifyS.QuietHours>, QuietHours>>,
  Check<Same<Decoded<typeof PortsS.PortsListing>, Ports.PortsListing>>,
  Check<Same<Decoded<typeof PtyS.PtySpawnOptions>, Pty.PtySpawnOptions>>,
  Check<Same<Decoded<typeof AccountS.MochiAccount>, Account.MochiAccount>>,
];
