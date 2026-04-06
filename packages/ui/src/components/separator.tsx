import { Separator as RadixSeparator } from 'radix-ui'
import type React from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/utils'

export interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof RadixSeparator.Root> {
  variant?: 'solid' | 'dashed'
}

const Separator = forwardRef<React.ComponentRef<typeof RadixSeparator.Root>, SeparatorProps>(
  ({ className, orientation = 'horizontal', decorative = true, variant = 'solid', ...props }, ref) => (
    <RadixSeparator.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        variant === 'dashed' && 'border-0 border-dashed border-border',
        orientation === 'horizontal'
          ? variant === 'dashed'
            ? 'h-0 w-full border-t'
            : 'h-[1px] w-full'
          : variant === 'dashed'
            ? 'w-0 border-l'
            : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  ),
)
Separator.displayName = 'Separator'

// Alias for compat
const Divider = Separator

export { Divider, Separator }
