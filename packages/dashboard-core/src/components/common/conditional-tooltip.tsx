import type { TooltipProps } from '@manta/ui'
import { Tooltip } from '@manta/ui'
import type { PropsWithChildren } from 'react'

type ConditionalTooltipProps = PropsWithChildren<
  TooltipProps & {
    showTooltip?: boolean
  }
>

export const ConditionalTooltip = ({ children, showTooltip = false, ...props }: ConditionalTooltipProps) => {
  if (showTooltip) {
    return <Tooltip {...props}>{children}</Tooltip>
  }

  return children
}
