import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Clipboard, Code, Copy, FileDownload, Image, Link, Refresh, Scissors, SearchAlt, TextSelect } from '@/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { host } from '@/host';
import type { BrowserContextMenu, BrowserMenuCommand } from '@/host/types/browser';
import type { Thread } from '@/model';
import { copyText } from '../clipboard';
import type { Key } from '../keys';
import { getPrefs } from '../settings/prefs';
import { Shortcut } from '../Shortcut';
import { useDispatch } from '../store';
import { reloadPage, updatePage, type Page } from './pages';
import { openExternally, openInLabel } from './systemBrowser';
import { SEARCH_ENGINES } from './url';

const SELECTION_PREVIEW = 24;

/**
 * The page's right-click menu, drawn by the app at the click (`at`, frame px) with the app's own menu, over the page's snapshot.
 * What it offers follows what was clicked, like Chrome: a link, an image, selected text, a text field, else the page itself.
 */
export function PageMenu({ thread, pageId, page, menu, at }: { thread: Thread; pageId: string; page: Page; menu: BrowserContextMenu; at: { x: number; y: number } }) {
  const dispatch = useDispatch();
  const id = page.hostId;
  const run = (command: BrowserMenuCommand, url?: string) => id && void host.browser.menuCommand(id, command, { x: menu.x, y: menu.y }, url);
  const openTab = (url: string) => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'browser', url });
  const engine = SEARCH_ENGINES[getPrefs().searchEngine];
  const selection = menu.selectionText.trim().replace(/\s+/g, ' ');
  const isImage = menu.mediaType === 'image' && !!menu.srcUrl;
  const isPlain = !menu.linkUrl && !isImage && !selection && !menu.isEditable;

  return (
    <DropdownMenu open onOpenChange={(open) => !open && updatePage(pageId, { menu: null })}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute size-0" style={{ left: at.x, top: at.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-60" onCloseAutoFocus={(e) => e.preventDefault()}>
        {!!menu.linkUrl && (
          <Section>
            <Item icon={<ExternalLink />} onSelect={() => openTab(menu.linkUrl)}>
              Open link in new tab
            </Item>
            <Item icon={<ExternalLink />} onSelect={() => openExternally(menu.linkUrl)}>
              {openInLabel('link')}
            </Item>
            <Item icon={<Link />} onSelect={() => copyText(menu.linkUrl, 'Link copied')}>
              Copy link address
            </Item>
          </Section>
        )}
        {isImage && (
          <Section>
            <Item icon={<Image />} onSelect={() => openTab(menu.srcUrl)}>
              Open image in new tab
            </Item>
            <Item icon={<FileDownload />} onSelect={() => run('save-image', menu.srcUrl)}>
              Save image
            </Item>
            <Item icon={<Copy />} onSelect={() => run('copy-image')}>
              Copy image
            </Item>
            <Item icon={<Link />} onSelect={() => copyText(menu.srcUrl, 'Image address copied')}>
              Copy image address
            </Item>
          </Section>
        )}
        {menu.isEditable ? (
          <Section>
            <Item icon={<Scissors />} keys={['mod', 'X']} disabled={!menu.canCut} onSelect={() => run('cut')}>
              Cut
            </Item>
            <Item icon={<Copy />} keys={['mod', 'C']} disabled={!menu.canCopy} onSelect={() => run('copy')}>
              Copy
            </Item>
            <Item icon={<Clipboard />} keys={['mod', 'V']} disabled={!menu.canPaste} onSelect={() => run('paste')}>
              Paste
            </Item>
            <Item icon={<TextSelect />} keys={['mod', 'A']} onSelect={() => run('select-all')}>
              Select all
            </Item>
          </Section>
        ) : (
          !!selection && (
            <Section>
              <Item icon={<Copy />} keys={['mod', 'C']} onSelect={() => run('copy')}>
                Copy
              </Item>
              <Item icon={<SearchAlt />} onSelect={() => openTab(engine.url + encodeURIComponent(selection))}>
                <span className="truncate">
                  Search {engine.name} for “{selection.length > SELECTION_PREVIEW ? `${selection.slice(0, SELECTION_PREVIEW)}…` : selection}”
                </span>
              </Item>
            </Section>
          )
        )}
        {isPlain && (
          <Section>
            <Item icon={<ArrowLeft />} disabled={!page.canGoBack} onSelect={() => id && void host.browser.command(id, 'back')}>
              Back
            </Item>
            <Item icon={<ArrowRight />} disabled={!page.canGoForward} onSelect={() => id && void host.browser.command(id, 'forward')}>
              Forward
            </Item>
            <Item icon={<Refresh />} onSelect={() => reloadPage(pageId)}>
              Reload
            </Item>
          </Section>
        )}
        <DropdownMenuGroup>
          <Item icon={<Code />} onSelect={() => run('inspect')}>
            Inspect element
          </Item>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A group with the separator under it; the menu always ends with Inspect, so every group has something below. */
function Section({ children }: { children: ReactNode }) {
  return (
    <>
      <DropdownMenuGroup>{children}</DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  );
}

function Item({ icon, keys, disabled, onSelect, children }: { icon: ReactNode; keys?: Key[]; disabled?: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      {icon}
      {children}
      {!!keys && (
        <DropdownMenuShortcut className="tracking-normal">
          <Shortcut keys={keys} />
        </DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}
