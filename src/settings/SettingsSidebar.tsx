import { useState } from 'react';
import { ArrowLeft, Search } from '@/icons';
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
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Shortcut } from '../Shortcut';
import { SidebarResizer } from '../SidebarResizer';
import { goBack, openSettings, useSettingsRoute } from '../routes/nav';
import { SECTION_GROUPS, searchSettings, type SectionId } from './sections';
import { HARNESS_IDS } from './harnesses';
import { useAgentSettings } from './AgentSettings';

/** Takes the app sidebar's place, width and toggle while settings are open. */
export function SettingsSidebar({
  width,
  onResize,
}: {
  width: number;
  onResize: (px: number) => void;
}) {
  const route = useSettingsRoute();
  const [query, setQuery] = useState('');
  const { setOpenMobile } = useSidebar();
  const { isUpdateAvailable } = useAgentSettings();
  const results = searchSettings(query);
  const go = (section: SectionId, settingId?: string) => {
    openSettings(section, settingId);
    setOpenMobile(false);
  };

  return (
    <Sidebar>
      <SidebarHeader className="app-drag h-11 flex-row items-center py-0 pl-2 max-md:hidden md:in-data-traffic-lights:pl-[calc(var(--lights-end)+5px)]">
        <SidebarTrigger className="ml-1 text-muted-foreground" />
      </SidebarHeader>
      <div className="px-2 pb-2 max-md:pt-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <SidebarInput
            type="search"
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
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
                    <SidebarMenuButton
                      isActive={route?.section === section.id}
                      onClick={() => go(section.id)}
                    >
                      <section.icon />
                      {section.title}
                      {section.id === 'harnesses' &&
                        HARNESS_IDS.some(isUpdateAvailable) && (
                          <span
                            className="ml-auto size-1.5 rounded-full bg-warning"
                            aria-label="Update available"
                          />
                        )}
                    </SidebarMenuButton>
                    {settings.length > 0 && (
                      <SidebarMenuSub>
                        {settings.map((s) => (
                          <SidebarMenuSubItem key={s.id}>
                            <SidebarMenuSubButton asChild>
                              <button
                                type="button"
                                onClick={() => go(section.id, s.id)}
                              >
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
        {!results.length && (
          <p className="px-4 py-2 type-meta text-muted-foreground">
            No setting matches “{query.trim()}”.
          </p>
        )}
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={goBack}>
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
