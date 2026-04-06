// Alert system for tracking gaps and incompatibilities during discovery

export type AlertLevel = 'info' | 'warn' | 'error'
export type AlertLayer = 'shim' | 'module' | 'workflow' | 'subscriber' | 'link' | 'route' | 'admin'

export interface Alert {
  level: AlertLevel
  layer: AlertLayer
  artifact: string
  message: string
  suggestion?: string
}

const alerts: Alert[] = []

export function addAlert(alert: Alert): void {
  alerts.push(alert)
}

export function getAlerts(layer?: AlertLayer): Alert[] {
  if (layer) return alerts.filter((a) => a.layer === layer)
  return [...alerts]
}

export function getAlertsByLevel(level: AlertLevel): Alert[] {
  return alerts.filter((a) => a.level === level)
}

export function clearAlerts(): void {
  alerts.length = 0
}

export function hasErrors(layer?: AlertLayer): boolean {
  return getAlerts(layer).some((a) => a.level === 'error')
}

export function printAlerts(layer?: AlertLayer): void {
  const filtered = getAlerts(layer)
  if (filtered.length === 0) return

  for (const alert of filtered) {
    const prefix = alert.level === 'error' ? '❌' : alert.level === 'warn' ? '⚠️' : 'ℹ️'
    const msg = `${prefix} [${alert.layer}] ${alert.artifact}: ${alert.message}`
    if (alert.level === 'error') console.error(msg)
    else if (alert.level === 'warn') console.warn(msg)
    else console.log(msg)
    if (alert.suggestion) console.log(`   → ${alert.suggestion}`)
  }
}
