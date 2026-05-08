import { definePage, type HeaderDef } from '@manta/dashboard-core'

// Order detail page — same layout as paniers/[id]: header with titleField
// + Shopify deep link, then a stack of cards in the main column. Items are
// rendered as a DataList inside a Card (mirrors the cart Résumé), and the
// linked contact gets a dedicated card with a button to its detail page.

export default definePage({
  header: {
    titleField: 'title',
    descriptionField: 'email',
    linkField: 'shopify_url',
    linkLabelField: 'shopify_label',
    query: { name: 'order-header', input: { id: ':id' } },
  } as HeaderDef,

  main: [
    // ── Récapitulatif ────────────────────────────────────────────────
    {
      type: 'InfoCard',
      title: 'Récapitulatif',
      query: {
        graph: {
          entity: 'order',
          fields: [
            'status',
            'financial_status',
            'fulfillment_status',
            'currency',
            'total_price',
            'placed_at',
            'cancelled_at',
          ],
        },
      },
      fields: [
        {
          key: 'status',
          label: 'Statut',
          display: {
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
        { key: 'financial_status', label: 'Paiement' },
        { key: 'fulfillment_status', label: 'Fulfillment' },
        { key: 'currency', label: 'Devise' },
        { key: 'total_price', label: 'Total', display: 'currency' },
        { key: 'placed_at', label: 'Passée le', display: { type: 'date', format: 'long' } },
        { key: 'cancelled_at', label: 'Annulée le', display: { type: 'date', format: 'long' } },
      ],
    },

    // ── Articles — items from the order JSON snapshot ────────────────
    {
      type: 'Card',
      title: 'Articles',
      children: [
        {
          type: 'DataList',
          query: { graph: { entity: 'order', fields: ['items', 'currency'] } },
          itemsKey: 'items',
          emptyLabel: 'Aucun article',
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
      ],
    },

    // ── Client lié — link card to /clients/:contact_id ───────────────
    // The linked contact is fetched via the order_contact pivot. The header
    // action `Voir la fiche client →` resolves its destination from the
    // named query (`contact_url`) and hides itself when no contact is
    // linked yet.
    {
      type: 'Card',
      title: 'Client lié',
      actions: [
        {
          label: 'Voir la fiche client →',
          kind: 'link',
          source: { name: 'order-contact-info', input: { id: ':id' }, field: 'contact_url' },
          target: '_self',
        },
      ],
      children: [
        {
          type: 'InfoCard',
          title: 'Contact',
          query: { name: 'order-contact-info', input: { id: ':id' } },
          fields: [
            { key: 'email', label: 'Email' },
            { key: 'first_name', label: 'Prénom' },
            { key: 'last_name', label: 'Nom' },
            { key: 'orders_count', label: 'Commandes (lifetime)', display: 'text' },
          ],
        },
      ],
    },
  ],
})
