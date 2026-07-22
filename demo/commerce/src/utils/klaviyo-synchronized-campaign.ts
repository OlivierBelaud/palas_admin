/** Keep the ordering explicit and testable: no provider effect can start after a failed sync. */
export async function runAfterKlaviyoProjectionSync<T>(
  sync: () => Promise<unknown>,
  campaign: () => Promise<T>,
): Promise<T> {
  await sync()
  return campaign()
}
