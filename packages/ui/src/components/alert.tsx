import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import type React from 'react'
import { forwardRef, useState } from 'react'
import { cn } from '../lib/utils'

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        error: 'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning: 'border-orange-500/50 text-orange-700 dark:text-orange-400',
        success: 'border-green-500/50 text-green-700 dark:text-green-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  dismissible?: boolean
}

const Alert = forwardRef<HTMLDivElement, AlertProps>(({ className, variant, dismissible, children, ...props }, ref) => {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {children}
      {dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 rounded-md p-1 opacity-70 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
})
Alert.displayName = 'Alert'

const AlertTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  ),
)
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
  ),
)
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertDescription, AlertTitle }
