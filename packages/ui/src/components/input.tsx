import type React from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/utils'

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'default' | 'small'
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type, size = 'default', ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex w-full rounded-md bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-all border border-transparent focus-visible:outline-none focus-visible:border-border focus-visible:ring-1 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'small' ? 'h-7 py-1 text-xs' : 'h-8 py-1.5',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
