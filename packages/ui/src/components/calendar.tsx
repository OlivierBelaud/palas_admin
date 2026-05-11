// Calendar — wraps react-day-picker@9 with shadcn-style classNames.
// Follows the official shadcn v9 calendar reference: `months` container is
// the positioning context, `nav` spans the full width absolutely at the top
// with `justify-between`, so prev/next chevrons sit at the LEFT/RIGHT edges
// of the calendar (not the popover). Without this, `button_previous`
// absolute-positioned with `left-1` falls back to the popover root and
// renders behind the preset rail.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import { cn } from '../lib/utils'
import { buttonVariants } from './button'

export type CalendarProps = DayPickerProps

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-4',
        month_caption: 'flex items-center justify-center h-8 w-full',
        caption_label: 'text-sm font-medium',
        nav: 'absolute top-0 inset-x-0 z-10 flex items-center justify-between h-8 pointer-events-none',
        button_previous: cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'pointer-events-auto size-7 bg-transparent p-0 opacity-70 hover:opacity-100',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'pointer-events-auto size-7 bg-transparent p-0 opacity-70 hover:opacity-100',
        ),
        month_grid: 'w-full border-collapse space-x-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
          'h-8 w-8 [&:has([aria-selected])]:bg-accent',
          '[&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50',
          '[&:has([aria-selected].day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
        ),
        day_button: cn(buttonVariants({ variant: 'ghost' }), 'size-8 p-0 font-normal aria-selected:opacity-100'),
        range_start: 'day-range-start rounded-l-md bg-primary text-primary-foreground hover:bg-primary',
        range_end: 'day-range-end rounded-r-md bg-primary text-primary-foreground hover:bg-primary',
        selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
        today: 'bg-accent text-accent-foreground',
        outside: 'day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-50',
        range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...iconProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" {...iconProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...iconProps} />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
