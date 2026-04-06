// PostHog query graph extension — declares which entities this module owns and routes
// Manta query graph requests to PostHog's HogQL / Insights APIs.
//
// The file is auto-discovered by the framework (scans modules/{name}/queries/*.ts).
// Because its default export uses `extendQueryGraph`, the framework registers it on
// the QueryService as a resolver for the listed entities.

import { extendQueryGraph } from '@manta/core'
import { executeHogQL, executeInsights } from './lib/execute'
import { SUPPORTED_FILTERS } from './lib/schema'

export default extendQueryGraph({
  owns: ['posthogEvent', 'posthogPerson', 'posthogInsight'],
  supportedFilters: SUPPORTED_FILTERS,
  async resolve(query) {
    // Case-insensitive dispatch — caller may pass 'posthogInsight', 'PostHogInsight',
    // 'posthoginsight', etc. depending on where they discovered the entity name (AI
    // system prompt lowercases module names, for example).
    if (typeof query.entity === 'string' && query.entity.toLowerCase() === 'posthoginsight') {
      return executeInsights(query)
    }
    return executeHogQL(query)
  },
})
