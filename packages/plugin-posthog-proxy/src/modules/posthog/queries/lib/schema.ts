// PostHog entity ↔ HogQL mapping — which ClickHouse tables + columns back each Manta entity.

/** Manta entity name → HogQL table name. */
export const ENTITY_TO_TABLE: Record<string, string> = {
  posthogEvent: 'events',
  posthogPerson: 'persons',
}

/** Manta field name → HogQL column path (supports dotted access for properties). */
export const FIELD_MAP: Record<string, Record<string, string>> = {
  posthogEvent: {
    id: 'uuid',
    event: 'event',
    distinctId: 'distinct_id',
    timestamp: 'timestamp',
    properties: 'properties',
    url: 'properties.$current_url',
    personId: 'person_id',
  },
  posthogPerson: {
    id: 'id',
    distinctId: 'distinct_id',
    email: 'properties.email',
    name: 'properties.name',
    createdAt: 'created_at',
    properties: 'properties',
  },
}

/** Filters supported per entity — anything else throws at query time. */
export const SUPPORTED_FILTERS: Record<string, string[]> = {
  posthogEvent: ['event', 'distinctId', 'personId', 'timestamp', 'after', 'before'],
  posthogPerson: ['email', 'distinctId', 'id'],
  posthogInsight: ['id', 'shortId'],
}

/**
 * Default ORDER BY clause per entity. Each ClickHouse table has its own time column —
 * `events.timestamp`, `persons.created_at` — and using the wrong one yields a 400
 * "Unable to resolve field" error. Keyed by canonical Manta entity name.
 */
export const DEFAULT_SORT: Record<string, string> = {
  posthogEvent: 'timestamp DESC',
  posthogPerson: 'created_at DESC',
}
