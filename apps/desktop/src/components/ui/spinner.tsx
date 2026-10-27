import { cn } from "@/lib/utils"
import { Loader as Loader2Icon, type IconProps } from '@/icons'

function Spinner({ className, ...props }: IconProps) {
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin motion-reduce:animate-[spin_2s_linear_infinite]", className)} {...props} />
  )
}

export { Spinner }
