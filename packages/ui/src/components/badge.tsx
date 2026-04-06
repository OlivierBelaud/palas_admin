import { cva, type VariantProps } from 'class-variance-authority'
import type React from 'react'
import { cn } from '../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        // Status badge variants (compat with StatusBadge color prop)
        green: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        red: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
        orange: 'border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
        blue: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        grey: 'border-transparent bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

// ── StatusBadge compat wrapper ──

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  color: 'green' | 'red' | 'orange' | 'blue' | 'grey'
}

function StatusBadge({ color, className, ...props }: StatusBadgeProps) {
  return <Badge variant={color} className={className} {...props} />
}

export { Badge, badgeVariants, StatusBadge }
