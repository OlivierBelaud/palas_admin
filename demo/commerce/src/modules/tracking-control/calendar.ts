import type { ControlWindow } from './types'

export function parisDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

export function earliestParisDate(now = new Date()): string {
  return new Date(Date.parse(`${parisDate(now)}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10)
}

function midnight(day: string): number {
  const target = Date.parse(`${day}T00:00:00Z`)
  let result = target
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(result))
    const p = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    result += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
  }
  return result
}

export function calendarWindow(day: string, now: Date): ControlWindow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const parsed = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null
  const today = parisDate(now)
  const earliest = earliestParisDate(now)
  if (day < earliest || day > today) return null
  const next = new Date(parsed.getTime() + 86400000).toISOString().slice(0, 10)
  const from = midnight(day)
  const to = Math.min(midnight(next), now.getTime())
  if (from >= to) return null
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), timezone: 'Europe/Paris' }
}
