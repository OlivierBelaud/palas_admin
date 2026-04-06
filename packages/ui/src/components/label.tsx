import { cva, type VariantProps } from 'class-variance-authority'
import { Label as RadixLabel } from 'radix-ui'
import type React from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/utils'

const labelVariants = cva('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70')

const Label = forwardRef<
  React.ComponentRef<typeof RadixLabel.Root>,
  React.ComponentPropsWithoutRef<typeof RadixLabel.Root> &
    VariantProps<typeof labelVariants> & {
      size?: 'small' | 'base' | 'large' | 'xsmall'
      weight?: 'regular' | 'plus'
    }
>(({ className, size: _size, weight: _weight, ...props }, ref) => (
  <RadixLabel.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
))
Label.displayName = 'Label'

export { Label }
