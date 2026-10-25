import { useState, type ReactNode } from 'react';
import {
  Chart,
  Clock,
  Connector,
  Inbox,
  Plugin,
  Route,
  Skill,
  type IconComponent,
} from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { DEFAULT_PREFS, setPrefs, usePrefs } from './settings/prefs';
import { openSettings } from './routes/nav';
import type { View } from './store';
import { OverflowIcon } from './ui';

/**
 * The sidebar destinations you choose (Edit sidebar), like Claude's: the ones you show, then More with the rest and
 * Edit sidebar…. Search, Projects, New thread, Review and Notifications are fixed and stay out of this list.
 */
export function SidebarNav({
  view,
  go,
  queueCount,
}: {
  view: View;
  go: (view: View) => void;
  queueCount: number;
}) {
  const { sidebarItems } = usePrefs();
  const [isEditing, setEditing] = useState(false);
  const shown = SIDEBAR_ITEMS.filter((item) => sidebarItems.includes(item.id));
  const hidden = SIDEBAR_ITEMS.filter(
    (item) => !sidebarItems.includes(item.id),
  );
  const open = (item: SidebarItem) =>
    'view' in item ? go(item.view) : openSettings(item.section);
  return (
    <>
      {shown.map((item) => (
        <NavItem
          key={item.id}
          icon={<item.icon />}
          label={item.label}
          isActive={'view' in item && view.kind === item.view?.kind}
          onClick={() => open(item)}
          badge={item.id === 'queue' && queueCount > 0 ? queueCount : undefined}
        />
      ))}
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="text-xs [&_svg]:size-3.5">
              <OverflowIcon />
              <span>More</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-52"
          >
            {hidden.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => open(item)}>
                <item.icon />
                {item.label}
              </DropdownMenuItem>
            ))}
            {hidden.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              Edit sidebar…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <Dialog open={isEditing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <EditSidebar onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

type SidebarItem = { id: string; label: string; icon: IconComponent } & (
  | { view: View }
  | { section: 'skills' | 'plugins' | 'connectors' | 'schedules' }
);

/** In sidebar order. Skills, Plugins, Connectors and Scheduled live in Settings; their items are shortcuts there. */
export const SIDEBAR_ITEMS = [
  { id: 'queue', label: 'Queue', icon: Inbox, view: { kind: 'queue' } },
  { id: 'board', label: 'Board', icon: Route, view: { kind: 'board' } },
  { id: 'usage', label: 'Usage', icon: Chart, view: { kind: 'usage' } },
  { id: 'skills', label: 'Skills', icon: Skill, section: 'skills' },
  { id: 'plugins', label: 'Plugins', icon: Plugin, section: 'plugins' },
  {
    id: 'connectors',
    label: 'Connectors',
    icon: Connector,
    section: 'connectors',
  },
  { id: 'schedules', label: 'Scheduled', icon: Clock, section: 'schedules' },
] satisfies SidebarItem[];

function EditSidebar({ onDone }: { onDone: () => void }) {
  const { sidebarItems } = usePrefs();
  const toggle = (id: string, isShown: boolean) =>
    setPrefs({
      sidebarItems: SIDEBAR_ITEMS.map((i) => i.id).filter((i) =>
        i === id ? isShown : sidebarItems.includes(i),
      ),
    });
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit sidebar</DialogTitle>
        <DialogDescription>
          Choose what shows in the sidebar. The rest stays under More.
        </DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col">
        {SIDEBAR_ITEMS.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40">
              <item.icon className="size-4 text-muted-foreground" />
              <span className="flex-1 type-body">{item.label}</span>
              <Switch
                checked={sidebarItems.includes(item.id)}
                onCheckedChange={(isShown) => toggle(item.id, isShown)}
                aria-label={`Show ${item.label} in the sidebar`}
              />
            </label>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => setPrefs({ sidebarItems: DEFAULT_PREFS.sidebarItems })}
        >
          Reset
        </Button>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}

export function NavItem({
  icon,
  label,
  isActive,
  onClick,
  trailing,
  badge,
  actions,
}: {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  badge?: number;
  actions?: ReactNode;
}) {
  return (
    <SidebarMenuItem className={cn(!!actions && 'flex items-center gap-0.5')}>
      <SidebarMenuButton
        isActive={isActive}
        onClick={onClick}
        className="text-xs [&_svg]:size-3.5"
      >
        {icon}
        <span>{label}</span>
        {!!trailing && (
          <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover/menu-item:opacity-100">
            {trailing}
          </span>
        )}
      </SidebarMenuButton>
      {badge !== undefined && (
        <SidebarMenuBadge className="tabular">{badge}</SidebarMenuBadge>
      )}
      {actions}
    </SidebarMenuItem>
  );
}
