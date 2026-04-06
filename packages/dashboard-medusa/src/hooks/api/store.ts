import { queryKeysFactory } from '@manta/dashboard-core'
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { sdk } from '../../lib/sdk'

const STORE_QUERY_KEY = 'store' as const
export const storeQueryKeys = queryKeysFactory(STORE_QUERY_KEY)

async function retrieveActiveStore(query?: Record<string, unknown>): Promise<{ store: any }> {
  const response = await sdk.admin.store.list(query)
  const activeStore = (response as any).stores?.[0]

  if (!activeStore) {
    throw new Error('No active store found')
  }

  return { store: activeStore }
}

export const useStore = (
  query?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<any, Error, any, QueryKey>, 'queryFn' | 'queryKey'>,
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => retrieveActiveStore(query),
    queryKey: storeQueryKeys.details(),
    ...options,
  })

  return {
    ...data,
    ...rest,
  }
}
