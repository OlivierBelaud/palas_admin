// ActiveRunsBridge — render-less component that resurrects persistent workflow
// toasts when the user navigates back to the page that spawned a live run.

import { useResurrectActiveRuns } from './use-resurrect-active-runs'

export function ActiveRunsBridge(): null {
  useResurrectActiveRuns()
  return null
}
