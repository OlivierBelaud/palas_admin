// DateRangePicker — Popover trigger + Calendar (range) + preset list.
// Controlled component: emits DateRangeValue via onChange. NO URL coupling.

import { Calendar as CalendarIcon } from 'lucide-react'
import * as React from 'react'
import type { DateRange } from 'react-day-picker'
import { type DateRangePreset, type DateRangeValue, formatRangeLabel, RANGE_PRESETS } from '../lib/date-range'
import { cn } from '../lib/utils'
import { Button } from './button'
import { Calendar } from './calendar'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export interface DateRangePickerProps {
  value?: DateRangeValue
  onChange: (next: DateRangeValue) => void
  allowedPresets?: DateRangePreset[]
  allowCustom?: boolean
  className?: string
  /** Override the trigger button content. Defaults to formatRangeLabel(value). */
  label?: string
}

function toIsoDate(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10)
}

function valueToDayPickerRange(v: DateRangeValue | undefined): DateRange | undefined {
  if (!v) return undefined
  if (v.kind === 'custom') {
    return { from: new Date(`${v.from}T00:00:00.000Z`), to: new Date(`${v.to}T00:00:00.000Z`) }
  }
  if (v.kind === 'date') {
    const d = new Date(`${v.date}T00:00:00.000Z`)
    return { from: d, to: d }
  }
  return undefined
}

export function DateRangePicker({
  value,
  onChange,
  allowedPresets = ['7d', '30d', '90d'],
  allowCustom = true,
  className,
  label,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const triggerLabel = label ?? (value ? formatRangeLabel(value) : 'Sélectionner une période')

  const presets = RANGE_PRESETS.filter((p) => allowedPresets.includes(p.value))

  const handlePreset = (preset: DateRangePreset) => {
    onChange({ kind: 'preset', preset })
    setOpen(false)
  }

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range?.from) return
    const from = toIsoDate(range.from)
    const to = range.to ? toIsoDate(range.to) : from
    if (from === to) {
      onChange({ kind: 'date', date: from })
    } else {
      onChange({ kind: 'custom', from, to })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="small" className={cn('justify-start gap-2', className)}>
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          {presets.length > 0 && (
            <div className="flex flex-col gap-1 border-r p-2 min-w-[10rem]">
              {presets.map((p) => {
                const isActive = value?.kind === 'preset' && value.preset === p.value
                return (
                  <button
                    type="button"
                    key={p.value}
                    onClick={() => handlePreset(p.value)}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}
          {allowCustom && (
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={valueToDayPickerRange(value)}
              onSelect={handleRangeSelect}
              defaultMonth={valueToDayPickerRange(value)?.from}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
