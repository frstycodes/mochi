import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import { ChevronRight } from '@/icons';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

const ACCORDION = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

/** A sidebar group folded under its label and count (Settled, Projects); the label toggles it. */
export function FoldGroup({
  label,
  count,
  isInitiallyOpen = false,
  children,
}: {
  label: string;
  count: number;
  isInitiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(isInitiallyOpen);
  const reduce = useReducedMotionConfig();
  const contentId = useId();
  return (
    <SidebarGroup className="mt-2">
      <SidebarGroupLabel asChild>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setOpen(!isOpen)}
          className="hover:text-sidebar-foreground"
        >
          {label}
          <span className="ml-1 tabular">{count}</span>
          <ChevronRight
            className={cn(
              'ml-1 size-3 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
              isOpen && 'rotate-90',
            )}
          />
        </button>
      </SidebarGroupLabel>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : ACCORDION}
            className="overflow-hidden"
          >
            <SidebarGroupContent>
              <SidebarMenu>{children}</SidebarMenu>
            </SidebarGroupContent>
          </motion.div>
        )}
      </AnimatePresence>
    </SidebarGroup>
  );
}
