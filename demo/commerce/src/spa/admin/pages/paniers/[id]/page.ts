import { definePage, type HeaderDef } from '@manta/dashboard-core'

// Enriched cart detail page — Shopify, Klaviyo, PostHog data via named queries.
// Named queries run server-side: they load the cart email, then query PostHog HogQL.

export default definePage({
  header: {
    titleField: 'title',
    linkField: 'posthog_url',
    linkLabelField: 'posthog_label',
    query: { name: 'cart-header', input: { id: ':id' } },
  } as HeaderDef,

  main: [
    // ── Résumé panier — articles + totaux dans une seule Card ─────────
    {
      type: 'Card',
      title: 'Résumé',
      children: [
        {
          type: 'DataList',
          query: { graph: { entity: 'cart', fields: ['items', 'currency'] } },
          itemsKey: 'items',
          emptyLabel: 'Panier vide',
          columns: [
            {
              key: 'title',
              type: 'thumbnail',
              thumbnailKey: 'image_url',
              subKeys: ['sku', 'variant_title'],
              width: 'minmax(0,1fr)',
            },
            { key: 'price', format: 'currency', width: 'minmax(80px,auto)', align: 'end' },
            { key: 'quantity', format: 'number', suffix: 'x', width: 'minmax(40px,auto)', align: 'center' },
            { key: 'line_price', format: 'currency', width: 'minmax(80px,auto)', align: 'end' },
          ],
        },
        {
          type: 'DataList',
          density: 'compact',
          dividers: false,
          query: { name: 'cart-totals', input: { id: ':id' } },
          emptyLabel: 'Totaux indisponibles',
          columns: [
            { key: 'label', width: 'minmax(0,1fr)' },
            { key: 'value', format: 'currency', width: 'auto', align: 'end' },
          ],
        },
      ],
    },

    // ── Client Shopify — stats lifetime ───────────────────────────────
    {
      type: 'StatsCard',
      title: 'Client Shopify',
      query: { name: 'cart-shopify-customer', input: { id: ':id' } },
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
      card: true,
      pageSize: 5,
      query: { name: 'cart-shopify-orders', input: { id: ':id' } },
      rowActions: [],
      actions: [
        {
          label: 'Voir le client sur Shopify ↗',
          kind: 'link',
          source: { name: 'cart-shopify-customer', input: { id: ':id' }, field: 'shopify_admin_url' },
        },
      ],
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

    // ── Timeline unifiée — PostHog navigation + Klaviyo events ────────
    {
      type: 'DataTable',
      title: 'Timeline',
      card: true,
      pageSize: 50,
      query: { name: 'cart-timeline', input: { id: ':id' } },
      rowActions: [],
      actions: [
        {
          label: 'Voir dans PostHog ↗',
          kind: 'link',
          source: { name: 'cart-header', input: { id: ':id' }, field: 'posthog_url' },
        },
        {
          label: 'Voir dans Klaviyo ↗',
          kind: 'link',
          source: { name: 'cart-klaviyo-profile', input: { id: ':id' }, field: 'klaviyo_profile_url' },
        },
      ],
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
              'cart:closed': 'gray',
              'cart:cleared': 'red',
              'cart:discount_applied': 'blue',
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
              'Added to Cart': 'green',
              'Viewed Collection': 'gray',
              'Merged Profile': 'gray',
              'Coupon Used': 'blue',
              'Coupon Assigned': 'blue',
              'Form submitted by profile': 'gray',
              'Form completed by profile': 'gray',
              'Cancelled Order': 'red',
            },
          },
        },
        {
          key: 'source',
          label: 'Source',
          filterable: ['PostHog', 'Klaviyo'],
          format: { type: 'badge', values: { PostHog: 'blue', Klaviyo: 'purple' } },
        },
        { key: 'occurred_at', label: 'Date', format: { type: 'date', format: 'long' } },
        { key: 'amount', label: 'Montant', format: 'number' },
      ],
    },
  ],

  sidebar: [
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
    {
      type: 'InfoCard',
      title: 'Panier',
      query: { name: 'cart-items', input: { id: ':id' } },
      fields: [
        { key: 'cart_token', label: 'Cart Token' },
        { key: 'articles', label: 'Articles' },
        { key: 'total', label: 'Total' },
        { key: 'remises', label: 'Remises' },
      ],
    },
    {
      type: 'InfoCard',
      title: 'Parcours',
      query: {
        graph: { entity: 'cart', fields: ['status', 'highest_stage', 'last_action', 'last_action_at'] },
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
    {
      type: 'InfoCard',
      title: 'Profil Klaviyo',
      query: { name: 'cart-klaviyo-profile', input: { id: ':id' } },
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
    {
      type: 'InfoCard',
      title: 'Dates',
      query: { graph: { entity: 'cart', fields: ['created_at', 'updated_at'] } },
      fields: [
        { key: 'created_at', label: 'Créé le', display: { type: 'date', format: 'long' } },
        { key: 'updated_at', label: 'Mis à jour', display: { type: 'date', format: 'long' } },
      ],
    },
  ],
})
