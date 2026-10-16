import * as React from "react"
import { cn } from "@/lib/utils"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check as CheckIcon } from 'reicon-react'

const CHECKBOX_CLASS =
  "peer relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary"
const CHECKBOX_INDICATOR_CLASS =
  "grid place-content-center text-current transition-[opacity,scale,filter] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=unchecked]:scale-50 data-[state=unchecked]:opacity-0 data-[state=unchecked]:blur-[2px] motion-reduce:transition-none [&>svg]:size-3.5"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(CHECKBOX_CLASS, className)}
      {...props}
    >
      {/* Mounted while unchecked too, so the check can shrink and blur out as well as in. */}
      <CheckboxPrimitive.Indicator
        forceMount
        data-slot="checkbox-indicator"
        className={CHECKBOX_INDICATOR_CLASS}
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

/** The checkbox's look without its control, for a choice whose own native input takes the click and the keyboard. */
function CheckboxMark({ checked, className }: { checked: boolean; className?: string }) {
  const state = checked ? "checked" : "unchecked"
  return (
    <span aria-hidden data-slot="checkbox" data-state={state} data-checked={checked || undefined} className={cn(CHECKBOX_CLASS, "pointer-events-none", className)}>
      <span data-slot="checkbox-indicator" data-state={state} className={CHECKBOX_INDICATOR_CLASS}>
        <CheckIcon />
      </span>
    </span>
  )
}

export { Checkbox, CheckboxMark }
