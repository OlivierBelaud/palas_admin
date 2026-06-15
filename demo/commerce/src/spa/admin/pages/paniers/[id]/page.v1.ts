import { definePage, type HeaderDef } from '@mantajs/dashboard'

export default definePage({
  // HeaderDef doesn't yet declare `linkLabelField` or `query`; cast to preserve
  // the runtime shape consumed by the custom cart-header renderer.
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
              'cart:closed': 'gray',
              'cart:discount_applied': 'blue',
              'checkout:started': 'blue',
              'checkout:contact_info_submitted': 'purple',
              'checkout:address_info_submitted': 'purple',
              'checkout:shipping_info_submitted': 'purple',
              'checkout:payment_info_submitted': 'orange',
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
      query: { name: 'cart-detail', input: { id: ':id' } },
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
        { key: 'cart_token', label: 'Cart Token' },
        { key: 'articles', label: 'Articles' },
        { key: 'total', label: 'Total' },
        { key: 'remises', label: 'Remises' },
      ],
    },
    {
      type: 'InfoCard',
      title: 'Parcours',
      query: { name: 'cart-detail', input: { id: ':id' } },
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
      title: 'Checkout',
      query: { name: 'cart-detail', input: { id: ':id' } },
      fields: [
        { key: 'total_price', label: 'Total' },
        { key: 'currency', label: 'Devise' },
        { key: 'subtotal_price', label: 'Sous-total' },
        { key: 'discounts_amount', label: 'Remises' },
        { key: 'shipping_method', label: 'Livraison' },
        { key: 'shipping_price', label: 'Frais de port' },
        { key: 'total_tax', label: 'TVA' },
        { key: 'checkout_token', label: 'Checkout Token' },
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
      query: { name: 'cart-detail', input: { id: ':id' } },
      fields: [
        { key: 'created_at', label: 'Créé le', display: { type: 'date', format: 'long' } },
        { key: 'updated_at', label: 'Mis à jour', display: { type: 'date', format: 'long' } },
      ],
    },
  ],
})
