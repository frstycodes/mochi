import { useState } from 'react';
import { ArrowLeft, Search } from 'reicon-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Shortcut } from '../Shortcut';
import { SidebarResizer } from '../SidebarResizer';
import { closeSettings, openSettings, useSettingsRoute } from './open';
import { SECTION_GROUPS, searchSettings, type SectionId } from './sections';

/** Takes the app sidebar's place, width and toggle while settings are open. */
export function SettingsSidebar({ width, onResize }: { width: number; onResize: (px: number) => void }) {
  const route = useSettingsRoute();
  const [query, setQuery] = useState('');
  const { setOpenMobile } = useSidebar();
  const results = searchSettings(query);
  const go = (section: SectionId, settingId?: string) => {
    openSettings(section, settingId);
    setOpenMobile(false);
  };

  return (
    <Sidebar>
      {/* Empty on desktop: it keeps the fixed sidebar toggle and the traffic lights clear, like the app sidebar's header. */}
      <SidebarHeader className="h-11 max-md:hidden" />
      <div className="relative px-2 pb-2 max-md:pt-2">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <SidebarInput type="search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
      </div>
      <SidebarContent>
        {SECTION_GROUPS.map((group) => {
          const items = results.filter((r) => r.section.group === group);
          if (!items.length) return null;
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{group}</SidebarGroupLabel>
              <SidebarMenu className="gap-0.5">
                {items.map(({ section, settings }) => (
                  <SidebarMenuItem key={section.id}>
                    <SidebarMenuButton isActive={route?.section === section.id} onClick={() => go(section.id)}>
                      <section.icon />
                      {section.title}
                    </SidebarMenuButton>
                    {settings.length > 0 && (
                      <SidebarMenuSub>
                        {settings.map((s) => (
                          <SidebarMenuSubItem key={s.id}>
                            <SidebarMenuSubButton asChild>
                              <button type="button" onClick={() => go(section.id, s.id)}>
                                {s.label}
                              </button>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
        {!results.length && <p className="px-4 py-2 type-meta text-muted-foreground">No setting matches “{query.trim()}”.</p>}
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={closeSettings}>
              <ArrowLeft />
              Back to app
              <Shortcut keys={['Esc']} className="ml-auto max-md:hidden" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarResizer width={width} onCommit={onResize} />
    </Sidebar>
  );
}
