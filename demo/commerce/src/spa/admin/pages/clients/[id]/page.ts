import { definePage, type HeaderDef } from '@manta/dashboard-core'

// Client detail — mirrors the cart-detail page (paniers/[id]) layout:
// header with titleField + a deep link to Shopify, then a stack of cards
// in the main column. Same mechanics, contact entity instead of cart.

export default definePage({
  header: {
    titleField: 'email',
    descriptionField: 'phone',
    linkField: 'shopify_url',
    linkLabelField: 'shopify_label',
    query: { name: 'contact-header', input: { id: ':id' } },
  } as HeaderDef,

  main: [
    // ── Identité — coordonnées du contact ────────────────────────────
    {
      type: 'InfoCard',
      title: 'Identité',
      query: {
        graph: {
          entity: 'contact',
          fields: ['email', 'phone', 'locale', 'first_name', 'last_name', 'country_code', 'city'],
        },
      },
      fields: [
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Téléphone' },
        { key: 'locale', label: 'Langue' },
        { key: 'first_name', label: 'Prénom' },
        { key: 'last_name', label: 'Nom' },
        { key: 'country_code', label: 'Pays' },
        { key: 'city', label: 'Ville' },
      ],
    },

    // ── Stats e-commerce — agrégats Shopify ──────────────────────────
    {
      type: 'StatsCard',
      title: 'Stats',
      query: {
        graph: {
          entity: 'contact',
          fields: ['orders_count', 'total_spent', 'first_order_at', 'last_order_at'],
        },
      },
      metrics: [
        { label: 'Commandes', key: 'orders_count', format: 'number' },
        { label: 'Total dépensé', key: 'total_spent', format: 'currency' },
        { label: 'Première commande', key: 'first_order_at' },
        { label: 'Dernière commande', key: 'last_order_at' },
      ],
    },

    // ── Commandes liées ──────────────────────────────────────────────
    {
      type: 'DataTable',
      title: 'Commandes',
      card: true,
      pageSize: 10,
      query: { name: 'contact-orders', input: { id: ':id' } },
      rowActions: [],
      columns: [
        { key: 'order_number', label: 'Commande', format: 'highlight' },
        {
          key: 'status',
          label: 'Statut',
          format: {
            type: 'badge',
            values: {
              pending: 'gray',
              paid: 'blue',
              fulfilled: 'green',
              cancelled: 'red',
              refunded: 'orange',
            },
          },
        },
        { key: 'total_price', label: 'Total', format: 'currency' },
        { key: 'placed_at', label: 'Date', format: { type: 'date', format: 'long' } },
        { key: 'fulfillment_status', label: 'Fulfillment', format: 'badge' },
      ],
      navigateTo: '/orders/:id',
    },

    // ── Paniers liés ─────────────────────────────────────────────────
    {
      type: 'DataTable',
      title: 'Paniers',
      card: true,
      pageSize: 10,
      query: { name: 'contact-carts', input: { id: ':id' } },
      rowActions: [],
      columns: [
        { key: 'last_action', label: 'Dernière action' },
        {
          key: 'last_action_at',
          label: 'Date',
          format: { type: 'date', format: 'long' },
        },
        { key: 'total_price', label: 'Montant', format: 'currency' },
        { key: 'item_count', label: 'Articles', format: 'number' },
        {
          key: 'highest_stage',
          label: 'Étape max',
          format: {
            type: 'badge',
            values: {
              cart: 'gray',
              checkout_started: 'blue',
              checkout_engaged: 'purple',
              payment_attempted: 'orange',
              completed: 'green',
            },
          },
        },
      ],
      navigateTo: '/paniers/:id',
    },

    // ── Liens externes — Shopify / Klaviyo / PostHog ─────────────────
    // The Card hosts both the external IDs (as a small InfoCard child) and
    // header actions that resolve to the corresponding deep-link URL via
    // the contact-deep-links named query. Each action hides itself when
    // the matching ID is missing (source field returns null).
    {
      type: 'Card',
      title: 'Liens externes',
      actions: [
        {
          label: 'Voir Shopify ↗',
          kind: 'link',
          source: { name: 'contact-deep-links', input: { id: ':id' }, field: 'shopify_url' },
        },
        {
          label: 'Voir Klaviyo ↗',
          kind: 'link',
          source: { name: 'contact-deep-links', input: { id: ':id' }, field: 'klaviyo_url' },
        },
        {
          label: 'Voir PostHog ↗',
          kind: 'link',
          source: { name: 'contact-deep-links', input: { id: ':id' }, field: 'posthog_url' },
        },
      ],
      children: [
        {
          type: 'InfoCard',
          title: 'IDs externes',
          query: {
            graph: {
              entity: 'contact',
              fields: ['shopify_customer_id', 'klaviyo_profile_id', 'distinct_id'],
            },
          },
          fields: [
            { key: 'shopify_customer_id', label: 'Shopify customer ID' },
            { key: 'klaviyo_profile_id', label: 'Klaviyo profile ID' },
            { key: 'distinct_id', label: 'PostHog distinct ID' },
          ],
        },
      ],
    },
  ],
})
