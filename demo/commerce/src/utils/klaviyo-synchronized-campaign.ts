/** Keep the ordering explicit and testable: no provider effect can start after a failed sync. */
export async function runAfterKlaviyoProjectionSync<T>(
  sync: () => Promise<unknown>,
  campaign: () => Promise<T>,
  onError?: (stage: 'sync' | 'campaign', error: unknown) => void,
): Promise<T> {
  try {
    await sync()
  } catch (error) {
    onError?.('sync', error)
    throw error
  }

  try {
    return await campaign()
  } catch (error) {
    onError?.('campaign', error)
    throw error
  }
}
