import { queryKeysFactory } from '@manta/dashboard-core'
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { sdk } from '../../lib/sdk'

const USERS_QUERY_KEY = 'users' as const
export const usersQueryKeys = {
  ...queryKeysFactory(USERS_QUERY_KEY),
  me: () => [USERS_QUERY_KEY, 'me'] as const,
}

export const useMe = (
  query?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<any, Error, any, QueryKey>, 'queryFn' | 'queryKey'>,
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.user.me(query),
    queryKey: usersQueryKeys.me(),
    ...options,
  })

  return {
    ...data,
    ...rest,
  }
}
