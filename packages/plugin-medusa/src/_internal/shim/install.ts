// Shim installer — verifies all shim components are loadable and reports status.

import { type Alert, addAlert, getAlerts } from '../alerts'
import { getAllExportKeys, isOverridden, OVERRIDDEN_KEYS, REAL_UTILS_COUNT, shimmedUtils } from './utils-proxy'

export interface ShimReport {
  totalExports: number
  realUtilsCount: number
  overriddenCount: number
  overriddenKeys: readonly string[]
  passedThroughCount: number
  alerts: Alert[]
}

/**
 * Install and verify the shim layer.
 * Returns a report with counts and any alerts.
 */
export function installShim(): ShimReport {
  const allKeys = getAllExportKeys()
  const totalExports = allKeys.length
  const overriddenCount = OVERRIDDEN_KEYS.length

  // Verify all overridden keys actually exist in the proxy
  for (const key of OVERRIDDEN_KEYS) {
    if (!(key in shimmedUtils)) {
      addAlert({
        level: 'error',
        layer: 'shim',
        artifact: key,
        message: `Override key "${key}" is not present in shimmed utils`,
        suggestion: 'Check that the override was applied correctly in utils-proxy.ts',
      })
    }
  }

  // Verify MedusaService was actually overridden (not the Medusa original)
  if (shimmedUtils.MedusaService === undefined) {
    addAlert({
      level: 'error',
      layer: 'shim',
      artifact: 'MedusaService',
      message: 'MedusaService is undefined after shimming',
    })
  }

  // Verify @medusajs/utils was loaded
  if (REAL_UTILS_COUNT === 0) {
    addAlert({
      level: 'error',
      layer: 'shim',
      artifact: '@medusajs/utils',
      message: '@medusajs/utils could not be loaded — 0 exports found',
      suggestion: 'Ensure @medusajs/utils is installed as a dependency',
    })
  } else if (REAL_UTILS_COUNT < 600) {
    addAlert({
      level: 'warn',
      layer: 'shim',
      artifact: '@medusajs/utils',
      message: `@medusajs/utils has ${REAL_UTILS_COUNT} exports (expected ~620+)`,
      suggestion: 'Medusa version may have changed — verify export count',
    })
  }

  // Verify key business exports are preserved (not accidentally overridden)
  const mustPreserve = ['Modules', 'MathBN', 'BigNumber', 'generateId', 'isString', 'isObject']
  for (const key of mustPreserve) {
    if (!(key in shimmedUtils)) {
      addAlert({
        level: 'warn',
        layer: 'shim',
        artifact: key,
        message: `Business export "${key}" is missing from shimmed utils`,
        suggestion: 'This export should pass through from @medusajs/utils unchanged',
      })
    }
  }

  const alerts = getAlerts('shim')
  return {
    totalExports,
    realUtilsCount: REAL_UTILS_COUNT,
    overriddenCount,
    overriddenKeys: OVERRIDDEN_KEYS,
    passedThroughCount: totalExports - overriddenCount,
    alerts,
  }
}

// Re-export for convenience
export { isOverridden, OVERRIDDEN_KEYS, shimmedUtils }
