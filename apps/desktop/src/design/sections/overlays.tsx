import { toast } from '@/toast/store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Kbd } from '@/components/ui/kbd';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Block, Grid, Section } from '../layout';
import { OverflowIcon } from '../../ui';
import { ModelPickersBlock } from './model-pickers';
import { ZoomChipBlock } from './zoom-chip';

export function OverlaysSection() {
  return (
    <Section
      id="overlays"
      title="Overlays"
      intro="Each opens from a real trigger. Popover level for menus and small things, float level for windows. Confirm dialogs only for what can't be undone."
    >
      <Grid>
        <ZoomChipBlock />
        <Block
          title="Tooltip, popover, hover card"
          use="Names for icon buttons; small details on click; previews on hover."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>
                Send the latest diff to Codex <Kbd>S</Kbd>
              </TooltipContent>
            </Tooltip>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverHeader>
                  <PopoverTitle>Goal v3</PopoverTitle>
                  <PopoverDescription>
                    Claude found 2 more steps at 15:00.
                  </PopoverDescription>
                </PopoverHeader>
              </PopoverContent>
            </Popover>
            <HoverCard openDelay={160} closeDelay={240}>
              <HoverCardTrigger asChild>
                <Button variant="outline">Hover card</Button>
              </HoverCardTrigger>
              <HoverCardContent className="surface-float w-80 rounded-xl bg-float p-4 shadow-float">
                <div className="flex flex-col gap-1">
                  <span className="type-title">Float level</span>
                  <span className="type-meta text-muted-foreground">
                    Used by the expanded goal window and PiP previews.
                    Translucent, blurred, deeper shadow.
                  </span>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
        </Block>
        <ModelPickersBlock />
        <Block
          title="Dropdown and context menu"
          use="Overflow actions on a button; the same actions on right-click."
        >
          <div className="flex flex-wrap items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Thread options"
                >
                  <OverflowIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    Copy branch name{' '}
                    <DropdownMenuShortcut>C</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem>Open in editor</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    Archive thread
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ContextMenu>
              <ContextMenuTrigger className="flex h-16 w-56 items-center justify-center rounded-xl border border-dashed type-meta text-muted-foreground">
                Right-click a thread row
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuGroup>
                  <ContextMenuItem>
                    Pin to Orbit <ContextMenuShortcut>P</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem>Move to space</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive">
                    Archive thread
                  </ContextMenuItem>
                </ContextMenuGroup>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </Block>
        <Block
          title="Dialog and alert dialog"
          use="Dialogs for focused tasks; alert dialogs only to confirm something irreversible."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Rename thread</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename thread</DialogTitle>
                  <DialogDescription>
                    The branch name stays the same.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Save name</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete worktree</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this worktree?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Uncommitted changes in feat/admin-usage are lost. This can't
                    be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep worktree</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => toast('Worktree deleted')}
                  >
                    Delete worktree
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Block>
        <Block
          title="Sheet and drawer"
          use="Sheets slide from the side (the summary panel on narrow screens); drawers come up from the bottom on phones."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Thread summary</SheetTitle>
                  <SheetDescription>
                    The pinned panel, as a sheet below 1280px.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline">Open drawer</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Answer from your phone</DrawerTitle>
                  <DrawerDescription>
                    The queue on a phone opens decisions in a drawer.
                  </DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <Button>Record fixtures</Button>
                  <DrawerClose asChild>
                    <Button variant="outline">Not now</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </div>
        </Block>
        <Block
          title="Command"
          use="The Cmd K palette: views, threads and steps in one list."
          wide
        >
          <Command className="max-w-lg rounded-xl border">
            <CommandInput placeholder="Jump to a thread, step or view" />
            <CommandList>
              <CommandEmpty>
                Nothing matches. Try a thread title or a step name.
              </CommandEmpty>
              <CommandGroup heading="Threads">
                <CommandItem>
                  Public API rate limiting
                  <CommandShortcut>Latitude</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  Admin usage dashboard
                  <CommandShortcut>Latitude</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </Block>
      </Grid>
    </Section>
  );
}
