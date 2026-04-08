import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    titleField: 'title',
    linkField: 'posthog_url',
    linkLabelField: 'posthog_label',
    query: {
      name: 'cart-header',
      input: { id: ':id' },
    },
  },
  main: [
    // ── Timeline des événements (plus récent en haut) ──────────────────
    {
      type: 'DataTable',
      title: 'Historique des actions',
      pagination: false,
      query: {
        name: 'cart-events-list',
        input: { id: ':id' },
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
              'cart:cleared': 'red',
              'cart:viewed': 'gray',
              'checkout:started': 'blue',
              'checkout:contact': 'purple',
              'checkout:address': 'purple',
              'checkout:shipping': 'purple',
              'checkout:payment': 'orange',
              'checkout:completed': 'green',
            },
          },
        },
        { key: 'item_count', label: 'Articles', format: 'number' },
        { key: 'montant', label: 'Montant' },
        { key: 'occurred_at', label: 'Date', format: { type: 'date', format: 'long' } },
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
          fields: ['email', 'first_name', 'last_name', 'phone', 'city', 'country_code', 'distinct_id', 'shopify_customer_id'],
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
        { key: 'shopify_customer_id', label: 'Shopify ID' },
      ],
    },
    {
      type: 'InfoCard',
      title: 'Panier',
      query: {
        name: 'cart-items',
        input: { id: ':id' },
      },
      fields: [
        { key: 'articles', label: 'Articles' },
        { key: 'total', label: 'Total' },
        { key: 'remises', label: 'Remises' },
      ],
    },
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
        { key: 'status', label: 'Statut', display: { type: 'badge', values: { active: 'blue', cart_abandoned: 'orange', checkout_abandoned: 'orange', payment_abandoned: 'red', completed: 'green' } } },
        { key: 'highest_stage', label: 'Étape max' },
        { key: 'last_action', label: 'Dernière action' },
        { key: 'last_action_at', label: 'Dernière activité', display: { type: 'date', format: 'long' } },
      ],
    },
    {
      type: 'InfoCard',
      title: 'Checkout',
      query: {
        graph: {
          entity: 'cart',
          fields: ['total_price', 'currency', 'subtotal_price', 'discounts_amount', 'shipping_method', 'shipping_price', 'total_tax', 'order_id', 'shopify_order_id', 'is_first_order'],
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
        { key: 'order_id', label: 'Order Token' },
        { key: 'shopify_order_id', label: 'Shopify Order ID' },
        { key: 'is_first_order', label: '1ère commande', display: { type: 'badge', true: { label: 'Oui', color: 'green' }, false: { label: 'Non', color: 'gray' } } },
      ],
    },
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
