import { toast } from '@/toast/store';
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle } from '@/components/ui/navigation-menu';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Block, Grid, Section } from '../layout';

const stay = (e: React.MouseEvent) => e.preventDefault();

export function NavigationSection() {
  return (
    <Section id="navigation" title="Navigation" intro="Tabs switch views in place, breadcrumbs show where a thread lives, menus hold the app commands.">
      <Grid>
        <Block title="Tabs" use="Segmented tabs for a small set of peer views; line tabs inside panels.">
          <Tabs defaultValue="changes">
            <TabsList>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="browser">Browser</TabsTrigger>
              <TabsTrigger value="terminal">Terminal</TabsTrigger>
            </TabsList>
            <TabsContent value="changes" className="type-meta text-muted-foreground">
              14 files, +612 −389
            </TabsContent>
            <TabsContent value="browser" className="type-meta text-muted-foreground">
              localhost:3000/admin/usage
            </TabsContent>
            <TabsContent value="terminal" className="type-meta text-muted-foreground">
              pnpm dev is running
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="steps">
            <TabsList variant="line">
              <TabsTrigger value="steps">Steps</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
            </TabsList>
          </Tabs>
        </Block>
        <Block title="Breadcrumb" use="Space, project and thread. Long trails collapse into an ellipsis.">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#" onClick={stay}>
                  Latitude
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#" onClick={stay}>
                  latitude
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">Migrate auth to Better Auth and keep every existing session alive</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Block>
        <Block title="Pagination" use="Long histories: run logs, settled threads.">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" onClick={stay} />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" onClick={stay}>
                  1
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" onClick={stay} isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" onClick={stay}>
                  3
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" onClick={stay} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Block>
        <Block title="Menubar" use="The desktop app's menu: File, Thread, View.">
          <Menubar className="w-fit">
            <MenubarMenu>
              <MenubarTrigger>Thread</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarItem onSelect={() => toast('New thread')}>
                    New thread <MenubarShortcut>⌘N</MenubarShortcut>
                  </MenubarItem>
                  <MenubarItem>Second opinion</MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem variant="destructive">Settle thread</MenubarItem>
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>View</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarCheckboxItem checked>Summary panel</MenubarCheckboxItem>
                  <MenubarCheckboxItem>Floating previews</MenubarCheckboxItem>
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </Block>
        <Block title="Navigation menu" use="Top-level navigation with rich dropdowns, for the marketing site and docs." wide>
          <div className="pb-48">
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Product</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-80 gap-1 p-1">
                      {[
                        ['Threads', 'One goal per thread, settled when done.'],
                        ['Orbit', 'Hold Option to jump anywhere.'],
                        ['Board', 'Every thread as a metro line.'],
                      ].map(([title, body]) => (
                        <li key={title}>
                          <NavigationMenuLink href="#" onClick={stay}>
                            <span className="font-medium">{title}</span>
                            <span className="type-caption text-muted-foreground">{body}</span>
                          </NavigationMenuLink>
                        </li>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink href="#" onClick={stay} className={navigationMenuTriggerStyle()}>
                    Docs
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>
        </Block>
      </Grid>
    </Section>
  );
}
