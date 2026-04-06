import { Avatar as RadixAvatar } from 'radix-ui'
import type React from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/utils'

const AvatarRoot = forwardRef<
  React.ComponentRef<typeof RadixAvatar.Root>,
  React.ComponentPropsWithoutRef<typeof RadixAvatar.Root>
>(({ className, ...props }, ref) => (
  <RadixAvatar.Root
    ref={ref}
    className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
    {...props}
  />
))
AvatarRoot.displayName = 'AvatarRoot'

const AvatarImage = forwardRef<
  React.ComponentRef<typeof RadixAvatar.Image>,
  React.ComponentPropsWithoutRef<typeof RadixAvatar.Image>
>(({ className, ...props }, ref) => (
  <RadixAvatar.Image ref={ref} className={cn('aspect-square h-full w-full', className)} {...props} />
))
AvatarImage.displayName = 'AvatarImage'

const AvatarFallback = forwardRef<
  React.ComponentRef<typeof RadixAvatar.Fallback>,
  React.ComponentPropsWithoutRef<typeof RadixAvatar.Fallback>
>(({ className, ...props }, ref) => (
  <RadixAvatar.Fallback
    ref={ref}
    className={cn('flex h-full w-full items-center justify-center rounded-full bg-muted text-sm', className)}
    {...props}
  />
))
AvatarFallback.displayName = 'AvatarFallback'

// ── Compat wrapper matching @medusajs/ui Avatar API ──

type AvatarSize = 'xsmall' | 'small' | 'base' | 'large' | 'xlarge'

const sizeMap: Record<AvatarSize, string> = {
  xsmall: 'h-5 w-5 text-[10px]',
  small: 'h-6 w-6 text-xs',
  base: 'h-8 w-8 text-sm',
  large: 'h-10 w-10 text-base',
  xlarge: 'h-14 w-14 text-lg',
}

export interface AvatarProps {
  src?: string
  fallback?: string
  size?: AvatarSize
  variant?: 'rounded' | 'squared'
  className?: string
}

const Avatar = ({ src, fallback, size = 'base', variant = 'rounded', className }: AvatarProps) => {
  const radiusClass = variant === 'squared' ? 'rounded-md' : 'rounded-full'

  return (
    <AvatarRoot className={cn(sizeMap[size], radiusClass, className)}>
      {src && <AvatarImage src={src} />}
      <AvatarFallback className={radiusClass}>{fallback}</AvatarFallback>
    </AvatarRoot>
  )
}

export { Avatar, AvatarFallback, AvatarImage, AvatarRoot }
