import { definePage, type HeaderDef } from '@manta/dashboard-core'

// Enriched cart detail page — all external data from PostHog Data Warehouse.
// Shopify customers/orders, Klaviyo profiles/events, PostHog navigation events.
// Cart snapshot from local DB (graph queries).

export default definePage({
  header: {
    titleField: 'title',
    linkField: 'posthog_url',
    linkLabelField: 'posthog_label',
    query: {
      name: 'cart-header',
      input: { id: ':id' },
    },
  } as HeaderDef,

  main: [
    // ── Customer Shopify — stats lifetime ─────────────────────────────
    {
      type: 'StatsCard',
      title: 'Client Shopify',
      query: {
        hogql: {
          query: `
            SELECT
              sc.first_name,
              sc.last_name,
              sc.number_of_orders,
              JSONExtractString(sc.amount_spent, 'amount') AS lifetime_revenue,
              sc.lifetime_duration,
              sc.created_at AS customer_since,
              JSONExtractString(sc.default_email_address, 'marketingState') AS marketing_state
            FROM shopify_customers sc
            WHERE JSONExtractString(sc.default_email_address, 'emailAddress') = ':email'
            LIMIT 1
          `,
        },
      },
      metrics: [
        { label: 'Commandes', key: 'number_of_orders', format: 'number' },
        { label: 'CA total (€)', key: 'lifetime_revenue', format: 'number' },
        { label: 'Client depuis', key: 'lifetime_duration' },
        { label: 'Marketing', key: 'marketing_state' },
      ],
    },

    // ── Commandes Shopify ─────────────────────────────────────────────
    {
      type: 'DataTable',
      title: 'Commandes Shopify',
      query: {
        hogql: {
          query: `
            SELECT
              so.name AS order_name,
              so.display_financial_status AS status,
              JSONExtractString(so.total_price_set, 'shopMoney', 'amount') AS total,
              JSONExtractString(so.total_price_set, 'shopMoney', 'currencyCode') AS currency,
              so.created_at
            FROM shopify_orders so
            WHERE so.email = ':email'
            ORDER BY so.created_at DESC
            LIMIT 20
          `,
        },
      },
      columns: [
        { key: 'order_name', label: 'Commande', format: 'highlight' },
        {
          key: 'status',
          label: 'Statut',
          format: {
            type: 'badge',
            values: { PAID: 'green', PENDING: 'orange', REFUNDED: 'red', PARTIALLY_REFUNDED: 'orange' },
          },
        },
        { key: 'total', label: 'Total (€)' },
        { key: 'created_at', label: 'Date', format: { type: 'date', format: 'short' } },
      ],
    },

    // ── Timeline unifiée — PostHog events + Klaviyo events ────────────
    // Merge cart/checkout events (PostHog) et Klaviyo events (Viewed Product,
    // Placed Order, emails reçus, etc.) dans un flux chronologique.
    {
      type: 'DataTable',
      title: 'Timeline',
      pagination: false,
      query: {
        hogql: {
          query: `
            WITH timeline AS (
              SELECT
                e.event AS action,
                e.timestamp AS occurred_at,
                'navigation' AS source,
                JSONExtractString(e.properties, '$current_url') AS detail,
                toFloat64OrNull(JSONExtractRaw(e.properties, 'total_price')) AS amount
              FROM events e
              WHERE person.properties.email = ':email'
                AND (e.event LIKE 'cart:%' OR e.event LIKE 'checkout:%')
              UNION ALL
              SELECT
                km.name AS action,
                ke.datetime AS occurred_at,
                'klaviyo' AS source,
                coalesce(
                  JSONExtractString(ke.event_properties, 'Subject'),
                  JSONExtractString(ke.event_properties, 'Campaign Name'),
                  JSONExtractString(ke.event_properties, 'Product Name'),
                  JSONExtractString(ke.event_properties, 'Variant Name'),
                  ''
                ) AS detail,
                toFloat64OrNull(JSONExtractRaw(ke.event_properties, '$value')) AS amount
              FROM klaviyo_events ke
              JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
              JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
              WHERE kp.email = ':email'
            )
            SELECT action, occurred_at, source, detail, amount
            FROM timeline
            ORDER BY occurred_at DESC
            LIMIT 100
          `,
        },
      },
      columns: [
        {
          key: 'action',
          label: 'Action',
          format: {
            type: 'badge',
            values: {
              'cart:product_added': 'green',
              'cart:product_removed': 'red',
              'cart:updated': 'blue',
              'cart:viewed': 'gray',
              'checkout:started': 'blue',
              'checkout:contact_info_submitted': 'purple',
              'checkout:address_info_submitted': 'purple',
              'checkout:shipping_info_submitted': 'purple',
              'checkout:payment_info_submitted': 'orange',
              'checkout:completed': 'green',
              'Viewed Product': 'gray',
              'Active on Site': 'gray',
              'Checkout Started': 'blue',
              'Placed Order': 'green',
              'Ordered Product': 'green',
              'Fulfilled Order': 'green',
              'Received Email': 'purple',
              'Opened Email': 'purple',
              'Clicked Email': 'purple',
              'Subscribed to Email Marketing': 'blue',
              'Subscribed to List': 'blue',
            },
          },
        },
        {
          key: 'source',
          label: 'Source',
          format: { type: 'badge', values: { navigation: 'blue', klaviyo: 'purple' } },
        },
        { key: 'detail', label: 'Détail' },
        { key: 'amount', label: 'Montant', format: 'number' },
        { key: 'occurred_at', label: 'Date', format: { type: 'date', format: 'long' } },
      ],
    },
  ],

  sidebar: [
    // ── Identité client ───────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Client',
      query: {
        graph: {
          entity: 'cart',
          fields: ['email', 'first_name', 'last_name', 'phone', 'city', 'country_code', 'distinct_id'],
        },
      },
      fields: [
        { key: 'email', label: 'Email' },
        { key: 'first_name', label: 'Prénom' },
        { key: 'last_name', label: 'Nom' },
        { key: 'phone', label: 'Téléphone' },
        { key: 'city', label: 'Ville' },
        { key: 'country_code', label: 'Pays' },
        { key: 'distinct_id', label: 'PostHog ID' },
      ],
    },

    // ── Panier actuel ─────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Panier',
      query: {
        name: 'cart-items',
        input: { id: ':id' },
      },
      fields: [
        { key: 'cart_token', label: 'Cart Token' },
        { key: 'articles', label: 'Articles' },
        { key: 'total', label: 'Total' },
        { key: 'remises', label: 'Remises' },
      ],
    },

    // ── Parcours ──────────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Parcours',
      query: {
        graph: {
          entity: 'cart',
          fields: ['status', 'highest_stage', 'last_action', 'last_action_at'],
        },
      },
      fields: [
        {
          key: 'status',
          label: 'Statut',
          display: {
            type: 'badge',
            values: {
              active: 'blue',
              cart_abandoned: 'orange',
              checkout_abandoned: 'orange',
              payment_abandoned: 'red',
              completed: 'green',
            },
          },
        },
        { key: 'highest_stage', label: 'Étape max' },
        { key: 'last_action', label: 'Dernière action' },
        { key: 'last_action_at', label: 'Dernière activité', display: { type: 'date', format: 'long' } },
      ],
    },

    // ── Profil Klaviyo ────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Profil Klaviyo',
      query: {
        hogql: {
          query: `
            SELECT
              kp.email,
              kp.first_name,
              kp.last_name,
              JSONExtractString(kp.location, 'city') AS city,
              JSONExtractString(kp.location, 'country') AS country,
              JSONExtractString(kp.properties, 'Langue') AS langue,
              kp.created AS subscribed_since,
              kp.last_event_date
            FROM klaviyo_profiles kp
            WHERE kp.email = ':email'
            LIMIT 1
          `,
        },
      },
      fields: [
        { key: 'first_name', label: 'Prénom' },
        { key: 'last_name', label: 'Nom' },
        { key: 'langue', label: 'Langue' },
        { key: 'city', label: 'Ville' },
        { key: 'country', label: 'Pays' },
        { key: 'subscribed_since', label: 'Inscrit depuis', display: { type: 'date', format: 'short' } },
        { key: 'last_event_date', label: 'Dernier event', display: { type: 'date', format: 'short' } },
      ],
    },

    // ── Checkout details ──────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Checkout',
      query: {
        graph: {
          entity: 'cart',
          fields: [
            'total_price',
            'currency',
            'subtotal_price',
            'discounts_amount',
            'shipping_method',
            'shipping_price',
            'total_tax',
            'shopify_order_id',
            'is_first_order',
          ],
        },
      },
      fields: [
        { key: 'total_price', label: 'Total' },
        { key: 'currency', label: 'Devise' },
        { key: 'subtotal_price', label: 'Sous-total' },
        { key: 'discounts_amount', label: 'Remises' },
        { key: 'shipping_method', label: 'Livraison' },
        { key: 'shipping_price', label: 'Frais de port' },
        { key: 'total_tax', label: 'TVA' },
        { key: 'shopify_order_id', label: 'Order ID Shopify' },
        {
          key: 'is_first_order',
          label: '1ère commande',
          display: { type: 'badge', true: { label: 'Oui', color: 'green' }, false: { label: 'Non', color: 'gray' } },
        },
      ],
    },

    // ── Dates ─────────────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Dates',
      query: {
        graph: {
          entity: 'cart',
          fields: ['created_at', 'updated_at'],
        },
      },
      fields: [
        { key: 'created_at', label: 'Créé le', display: { type: 'date', format: 'long' } },
        { key: 'updated_at', label: 'Mis à jour', display: { type: 'date', format: 'long' } },
      ],
    },
  ],
})
