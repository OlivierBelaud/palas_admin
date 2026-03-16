import { QueryClient } from "@tanstack/react-query"

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 90000,
        retry: 1,
      },
    },
  })
}
