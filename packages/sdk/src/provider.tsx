// MantaProvider — React context provider for the SDK
// Provides the MantaClient to all hooks (useCommand, useQuery, useGraphQuery)

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type React from 'react'
import { createContext, useContext, useMemo } from 'react'
import { MantaClient, type MantaClientOptions } from './client'

const MantaContext = createContext<MantaClient | null>(null)

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

export interface MantaProviderProps extends MantaClientOptions {
  children: React.ReactNode
  /** Custom React Query client. Default: built-in with 30s stale time. */
  queryClient?: QueryClient
}

/**
 * MantaProvider — wraps your app with Manta SDK context.
 *
 * @example
 * ```tsx
 * <MantaProvider context="admin">
 *   <App />
 * </MantaProvider>
 * ```
 */
export function MantaProvider({ children, queryClient, ...clientOptions }: MantaProviderProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: only recreate on context/baseUrl change
  const client = useMemo(() => new MantaClient(clientOptions), [clientOptions.context, clientOptions.baseUrl])

  return (
    <MantaContext.Provider value={client}>
      <QueryClientProvider client={queryClient ?? defaultQueryClient}>{children}</QueryClientProvider>
    </MantaContext.Provider>
  )
}

/**
 * Get the MantaClient from context. Throws if not inside MantaProvider.
 */
export function useMantaClient(): MantaClient {
  const client = useContext(MantaContext)
  if (!client) {
    throw new Error('useMantaClient must be used inside <MantaProvider>')
  }
  return client
}
