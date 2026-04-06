import { cn } from '@manta/ui'
import type { CSSProperties } from 'react'

type SkeletonProps = {
  className?: string
  style?: CSSProperties
}

export const Skeleton = ({ className, style }: SkeletonProps) => {
  return <div aria-hidden className={cn('h-3 w-3 animate-pulse rounded-[4px] bg-muted', className)} style={style} />
}
