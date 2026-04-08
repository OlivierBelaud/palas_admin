import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    titleField: 'email',
    descriptionField: 'cart_token',
  },
  main: [
    // ── Contenu du panier ──────────────────────────────────────────────
    {
      type: 'JsonCard',
      title: 'Articles du panier',
      query: {
        graph: {
          entity: 'cart',
          fields: ['items'],
        },
      },
    },

    // ── Timeline des événements ────────────────────────────────────────
    {
      type: 'RelationTable',
      title: 'Historique des actions',
      query: {
        name: 'cart-detail',
        input: { id: ':id' },
      },
      dataPath: 'events',
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
              'checkout:contact_info_submitted': 'purple',
              'checkout:address_info_submitted': 'purple',
              'checkout:shipping_info_submitted': 'purple',
              'checkout:payment_info_submitted': 'orange',
              'checkout:completed': 'green',
            },
          },
        },
        { key: 'total_price', label: 'Montant', format: 'number' },
        { key: 'item_count', label: 'Articles', format: 'number' },
        { key: 'email', label: 'Email' },
        { key: 'occurred_at', label: 'Date', format: { type: 'date', format: 'long' } },
      ],
    },
  ],
  sidebar: [
    // ── Infos client ───────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Client',
      query: {
        graph: {
          entity: 'cart',
          fields: ['email', 'first_name', 'last_name', 'phone', 'city', 'country_code', 'shopify_customer_id'],
        },
      },
      fields: [
        { key: 'email', label: 'Email' },
        { key: 'first_name', label: 'Prénom' },
        { key: 'last_name', label: 'Nom' },
        { key: 'phone', label: 'Téléphone' },
        { key: 'city', label: 'Ville' },
        { key: 'country_code', label: 'Pays' },
        { key: 'shopify_customer_id', label: 'Shopify ID' },
      ],
    },

    // ── Funnel ─────────────────────────────────────────────────────────
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

    // ── Checkout ────────────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Checkout',
      query: {
        graph: {
          entity: 'cart',
          fields: ['order_id', 'shopify_order_id', 'shipping_method', 'shipping_price', 'discounts_amount', 'subtotal_price', 'total_tax', 'total_price', 'is_first_order'],
        },
      },
      fields: [
        { key: 'order_id', label: 'Order Token' },
        { key: 'shopify_order_id', label: 'Shopify Order ID' },
        { key: 'subtotal_price', label: 'Sous-total' },
        { key: 'discounts_amount', label: 'Remises' },
        { key: 'shipping_method', label: 'Livraison' },
        { key: 'shipping_price', label: 'Frais de port' },
        { key: 'total_tax', label: 'TVA' },
        { key: 'total_price', label: 'Total' },
        { key: 'is_first_order', label: 'Première commande', display: { type: 'badge', true: { label: 'Oui', color: 'green' }, false: { label: 'Non', color: 'gray' } } },
      ],
    },

    // ── Dates ──────────────────────────────────────────────────────────
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
