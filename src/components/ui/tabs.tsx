"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { motion, useReducedMotionConfig } from "motion/react"
import { useControllableState } from "@radix-ui/react-use-controllable-state"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

const TabsContext = React.createContext<{ value: string | undefined; id: string } | null>(null)
const TabsListContext = React.createContext<"default" | "line">("default")

function useTabs() {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error("TabsTrigger must be used inside Tabs")
  return ctx
}

function Tabs({
  className,
  orientation = "horizontal",
  value: valueProp,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const id = React.useId()
  const [value, setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? "",
    onChange: onValueChange,
  })
  return (
    <TabsContext.Provider value={{ value, id }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        orientation={orientation}
        value={value}
        onValueChange={setValue}
        className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
        {...props}
      />
    </TabsContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-7 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        // The list owns the hairline, so the underline sits on it and an overflow-x-auto list can't clip it.
        line: "gap-1 rounded-none bg-transparent p-0 shadow-[inset_0_-1px_0_var(--color-border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsListContext.Provider value={variant ?? "default"}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsListContext.Provider>
  )
}

const SLIDE = { duration: 0.2, ease: [0.77, 0, 0.175, 1] } as const

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const tabs = useTabs()
  const variant = React.useContext(TabsListContext)
  const isActive = tabs.value === value
  const reduceMotion = useReducedMotionConfig()
  const transition = reduceMotion ? { duration: 0 } : SLIDE

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative isolate inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 data-active:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:h-7 group-data-[variant=line]/tabs-list:rounded-none",
        className
      )}
      {...props}
    >
      {isActive && variant === "default" && <SegmentChip layoutId={`${tabs.id}-chip`} transition={transition} />}
      {isActive && variant === "line" && (
        <motion.span
          layoutId={`${tabs.id}-underline`}
          transition={transition}
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
        />
      )}
      {children}
    </TabsPrimitive.Trigger>
  )
}

function SegmentChip({ layoutId, transition }: { layoutId: string; transition: object }) {
  // Motion corrects scale distortion only for radii set in style, so read the token radius once and move it there.
  const [radius, setRadius] = React.useState<string>()
  const measure = React.useCallback((el: HTMLSpanElement | null) => {
    if (el && !radius) setRadius(getComputedStyle(el).borderRadius)
  }, [radius])
  return (
    <motion.span
      ref={measure}
      layoutId={layoutId}
      transition={transition}
      aria-hidden
      style={radius ? { borderRadius: radius } : undefined}
      className="absolute -inset-px -z-10 rounded-md bg-background shadow-sm dark:bg-input dark:shadow-none"
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
