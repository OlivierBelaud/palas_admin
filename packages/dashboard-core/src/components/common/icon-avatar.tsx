import { cn } from '@manta/ui'
import type { PropsWithChildren } from 'react'

type IconAvatarProps = PropsWithChildren<{
  className?: string
  size?: 'small' | 'large' | 'xlarge'
  variant?: 'squared' | 'rounded'
}>

export const IconAvatar = ({ size = 'small', variant = 'rounded', children, className }: IconAvatarProps) => {
  return (
    <div
      className={cn(
        'flex size-7 items-center justify-center border shadow-sm',
        variant === 'squared' && 'rounded-md',
        variant === 'rounded' && 'rounded-full',
        '[&>div]:flex [&>div]:items-center [&>div]:justify-center [&>div]:bg-background [&>div]:text-muted-foreground [&>div]:size-6',
        {
          'size-7 rounded-md [&>div]:size-6 [&>div]:rounded-[4px]': size === 'small',
          'size-10 rounded-lg [&>div]:size-9 [&>div]:rounded-[6px]': size === 'large',
          'size-12 rounded-xl [&>div]:size-11 [&>div]:rounded-[10px]': size === 'xlarge',
        },
        className,
      )}
    >
      <div>{children}</div>
    </div>
  )
}
