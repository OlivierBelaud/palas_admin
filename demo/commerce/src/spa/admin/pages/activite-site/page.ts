import { definePage } from '@manta/dashboard-core'

// Analytics page — PostHog Data Warehouse via HogQL.
// All three blocks use the `query: { hogql: { query: "..." } }` shape. Results go through
// the /api/admin/posthog/hogql relay endpoint, which requires POSTHOG_API_KEY server-side.

export default definePage({
  header: { title: "Activité du site" },
  main: [
    // ── StatsCard — compteurs du jour, une seule query HogQL à 3 colonnes ─────────
    {
      type: 'StatsCard',
      query: {
        hogql: {
          query: `
            SELECT
              COUNT(*) AS total_events,
              COUNT(DISTINCT distinct_id) AS unique_visitors,
              countIf(event = 'page_viewed') AS page_views
            FROM events
            WHERE toDate(timestamp) = today()
            LIMIT 1
          `,
        },
      },
      metrics: [
        { label: "Total événements aujourd'hui", key: 'total_events', format: 'number' },
        { label: "Visiteurs uniques aujourd'hui", key: 'unique_visitors', format: 'number' },
        { label: "Pages vues aujourd'hui", key: 'page_views', format: 'number' },
      ],
    },

    // ── StatsCard — CA + commandes + AOV sur 30 jours (checkout_completed) ───────
    {
      type: 'StatsCard',
      query: {
        hogql: {
          query: `
            SELECT
              COUNT(*) AS orders,
              ROUND(SUM(JSONExtractFloat(properties, 'totalPrice', 'amount')), 0) AS revenue_eur,
              ROUND(AVG(JSONExtractFloat(properties, 'totalPrice', 'amount')), 0) AS aov_eur,
              COUNT(DISTINCT distinct_id) AS unique_buyers
            FROM events
            WHERE event = 'checkout_completed'
              AND timestamp > now() - INTERVAL 30 DAY
            LIMIT 1
          `,
        },
      },
      metrics: [
        { label: 'Commandes (30 jours)', key: 'orders', format: 'number' },
        { label: 'CA (30 jours)', key: 'revenue_eur', format: 'number' },
        { label: 'Panier moyen', key: 'aov_eur', format: 'number' },
        { label: 'Clients uniques', key: 'unique_buyers', format: 'number' },
      ],
    },

    // ── DataTable — attribution des ventes par canal (first-touch via person.properties) ─
    // First-touch attribution : on lit les $initial_* propriétés du PROFIL persons (pas du
    // checkout event). Ces propriétés sont set au 1er contact et restent figées, donc on
    // attribue la conversion au canal qui a ramené le visiteur pour la première fois.
    // Groupes: Meta Ads paid (utm_medium=cpc + utm_source meta/fb/ig), Google Ads paid,
    // Email Klaviyo, Google/Facebook/Instagram organic, Direct, Internal/Returning.
    {
      type: 'DataTable',
      title: 'Attribution des ventes — 30 jours (first-touch)',
      query: {
        hogql: {
          query: `
            WITH attributed AS (
              SELECT
                CASE
                  WHEN person.properties.$initial_utm_medium = 'cpc'
                       AND lower(coalesce(person.properties.$initial_utm_source, '')) IN ('meta', 'facebook', 'fb', 'instagram', 'ig')
                    THEN 'Meta Ads (paid)'
                  WHEN person.properties.$initial_utm_medium = 'cpc'
                       AND lower(coalesce(person.properties.$initial_utm_source, '')) = 'google'
                    THEN 'Google Ads (paid)'
                  WHEN person.properties.$initial_utm_medium = 'cpc'
                    THEN concat('Paid (', coalesce(person.properties.$initial_utm_source, 'unknown'), ')')
                  WHEN lower(coalesce(person.properties.$initial_utm_source, '')) = 'klaviyo'
                    OR person.properties.$initial_utm_medium = 'email'
                    THEN 'Email (Klaviyo)'
                  WHEN position(coalesce(person.properties.$initial_referring_domain, ''), 'google') > 0
                    THEN 'Google Organic'
                  WHEN position(coalesce(person.properties.$initial_referring_domain, ''), 'instagram') > 0
                    THEN 'Instagram Organic'
                  WHEN position(coalesce(person.properties.$initial_referring_domain, ''), 'facebook') > 0
                    THEN 'Facebook Organic'
                  WHEN person.properties.$initial_referring_domain = '$direct'
                    OR person.properties.$initial_referring_domain IS NULL
                    OR person.properties.$initial_referring_domain = ''
                    THEN 'Direct'
                  WHEN person.properties.$initial_referring_domain = 'fancypalas.com'
                    THEN 'Internal / Returning'
                  ELSE concat('Other: ', person.properties.$initial_referring_domain)
                END AS source,
                JSONExtractFloat(properties, 'totalPrice', 'amount') AS order_revenue
              FROM events
              WHERE event = 'checkout_completed'
                AND timestamp > now() - INTERVAL 30 DAY
            )
            SELECT
              source,
              COUNT(*) AS orders,
              ROUND(SUM(order_revenue), 0) AS revenue_eur,
              ROUND(AVG(order_revenue), 0) AS aov_eur
            FROM attributed
            GROUP BY source
            ORDER BY revenue_eur DESC
            LIMIT 20
          `,
        },
      },
      columns: [
        { key: 'source', label: 'Canal', format: 'highlight' },
        { key: 'orders', label: 'Commandes', format: 'number', sortable: true },
        { key: 'revenue_eur', label: 'CA (€)', format: 'number', sortable: true },
        { key: 'aov_eur', label: 'Panier moyen (€)', format: 'number', sortable: true },
      ],
    },

    // ── DataTable — les 500 derniers events, toutes sources confondues ───────────
    {
      type: 'DataTable',
      title: 'Flux live — 500 derniers événements',
      query: {
        hogql: {
          query: `
            SELECT
              event,
              distinct_id,
              timestamp,
              JSONExtractString(properties, '$current_url') AS pathname
            FROM events
            ORDER BY timestamp DESC
            LIMIT 500
          `,
        },
      },
      columns: [
        { key: 'event', label: 'Événement', format: 'highlight', sortable: true },
        { key: 'distinct_id', label: 'Visiteur', sortable: true },
        { key: 'timestamp', label: 'Horodatage', format: 'datetime', sortable: true },
        { key: 'pathname', label: 'Page' },
      ],
      searchable: true,
    },

    // ── DataTable — top 15 événements des 7 derniers jours ────────────────────────
    {
      type: 'DataTable',
      title: 'Top 15 événements sur 7 jours',
      query: {
        hogql: {
          query: `
            SELECT
              event,
              COUNT(*) AS count,
              COUNT(DISTINCT distinct_id) AS unique_visitors
            FROM events
            WHERE timestamp > now() - INTERVAL 7 DAY
            GROUP BY event
            ORDER BY count DESC
            LIMIT 15
          `,
        },
      },
      columns: [
        { key: 'event', label: 'Événement', format: 'highlight' },
        { key: 'count', label: 'Occurrences', format: 'number', sortable: true },
        { key: 'unique_visitors', label: 'Visiteurs uniques', format: 'number', sortable: true },
      ],
    },
  ],
})
