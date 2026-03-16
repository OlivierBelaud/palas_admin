import { clx } from "@medusajs/ui"
import { CSSProperties } from "react"

type SkeletonProps = {
  className?: string
  style?: CSSProperties
}

export const Skeleton = ({ className, style }: SkeletonProps) => {
  return (
    <div
      aria-hidden
      className={clx(
        "bg-ui-bg-component h-3 w-3 animate-pulse rounded-[4px]",
        className
      )}
      style={style}
    />
  )
}
