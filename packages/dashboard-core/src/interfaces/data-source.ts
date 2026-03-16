/**
 * DataSource — how the dashboard fetches data from the backend.
 * Each distribution implements this differently:
 * - Medusa: session cookies, static entity→endpoint maps
 * - Manta: JWT Bearer, dynamic endpoint map from registry
 */
export interface DataSource {
  /** Fetch data from a resolved endpoint */
  fetch(endpoint: string, params?: Record<string, unknown>): Promise<unknown>
  /** Mutate data (POST/PUT/DELETE) */
  mutate(endpoint: string, method: string, body?: unknown): Promise<unknown>
  /** Map an entity name to an API endpoint path */
  entityToEndpoint(entity: string): string
  /** Get the query key prefix for React Query cache matching */
  getQueryKey(entity: string): string
  /** Base URL of the backend API */
  baseUrl: string
}
