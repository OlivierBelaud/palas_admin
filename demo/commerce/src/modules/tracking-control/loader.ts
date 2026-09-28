import type { RawDb } from '../../utils/raw-db'
import { type ControlInput, loadLocalControl } from './local-query'
import { readProviderEvidence } from './providers'
import type { TrackingControlData } from './types'

export async function loadTrackingControl(input: ControlInput, db: RawDb): Promise<TrackingControlData> {
  const { local, providerInput } = await loadLocalControl(input, db)
  const provider = await readProviderEvidence(providerInput)
  return {
    destination: input.destination,
    generated_at: new Date().toISOString(),
    requested_window: input.window,
    config: provider.config,
    local,
    remote: provider.sections,
  }
}
