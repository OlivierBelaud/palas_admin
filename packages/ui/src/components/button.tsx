import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type React from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        secondary: 'bg-accent text-secondary-foreground hover:bg-[#e0e0e0]',
        ghost: 'text-foreground hover:bg-accent',
        transparent: 'text-muted-foreground hover:text-foreground hover:bg-accent',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-4 py-1.5',
        base: 'h-8 px-4 py-1.5',
        sm: 'h-7 px-3',
        small: 'h-7 px-3 text-xs',
        lg: 'h-9 px-6',
        icon: '!h-8 !w-8 !rounded-sm !p-0',
        'sm-icon': '!h-7 !w-7 !rounded-sm !p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isLoading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

// ── IconButton — just a Button with size="icon" ──

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size, className, style, ...props }, ref) => {
    const px = size === 'small' ? 24 : 28
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant }), 'flex items-center justify-center rounded-md p-0', className)}
        style={{ width: px, height: px, minWidth: px, minHeight: px, ...style }}
        {...props}
      />
    )
  },
)
IconButton.displayName = 'IconButton'

export { Button, buttonVariants, IconButton }
