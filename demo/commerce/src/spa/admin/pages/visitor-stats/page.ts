// /admin/visitor-stats — visitor-funnel dashboard.
//
// Five ChartCard blocks, each fed by its own pivot query:
//   - unique-visitors-by-segment   (line, multi-segment series)
//   - carts-created-funnel         (area, total + converted)
//   - carts-updated-funnel         (area, total + converted)
//   - identity-acquisitions        (bar, newsletter + checkout_started)
//   - paid-vs-organic              (line, paid + organic)
//
// All block ids are unique (CC-F04 enforces uniqueness via
// assertUniqueBlockIds — duplicates throw at render time). Per-block
// URL state lives under `range_<blockId>`; page-level shared range
// (CC-F01) is not yet implemented framework-side, so each chart owns
// its own picker for V1.
//
// Empty-DB safety: the underlying queries (visitor-stats-*) catch the
// "table missing" case and return empty rows + meta — ChartCard shows
// the "Aucune donnée" placeholder instead of crashing.

import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Visitor stats',
  },
  main: [
    {
      type: 'ChartCard',
      id: 'visitor-stats-unique-visitors',
      variant: 'line',
      title: 'Visiteurs uniques par jour',
      description: 'Distinct_id uniques par jour, segmentés.',
      query: { name: 'visitor-stats-unique-visitors-by-segment' },
      xKey: 'date',
      series: [
        { key: 'unknown', label: 'Inconnu', color: 'chart-1', format: 'number' },
        { key: 'known_no_purchase', label: 'Connu (no purchase)', color: 'chart-2', format: 'number' },
        { key: 'returning_customer', label: 'Returning customer', color: 'chart-3', format: 'number' },
      ],
      defaultRange: { kind: 'preset', preset: '30d' },
    },
    {
      type: 'ChartCard',
      id: 'visitor-stats-carts-created',
      variant: 'area',
      title: 'Paniers créés vs convertis',
      description: 'Total paniers créés en session vs sessions ayant créé un panier converti.',
      query: { name: 'visitor-stats-carts-created-funnel' },
      xKey: 'date',
      series: [
        { key: 'carts_created', label: 'Paniers créés', color: 'chart-1', format: 'number' },
        { key: 'carts_created_converted', label: 'Convertis', color: 'chart-2', format: 'number' },
      ],
      defaultRange: { kind: 'preset', preset: '30d' },
    },
    {
      type: 'ChartCard',
      id: 'visitor-stats-carts-updated',
      variant: 'area',
      title: 'Paniers modifiés vs convertis',
      description: 'Total modifications de panier en session vs sessions ayant modifié un panier converti.',
      query: { name: 'visitor-stats-carts-updated-funnel' },
      xKey: 'date',
      series: [
        { key: 'carts_updated', label: 'Modifications', color: 'chart-1', format: 'number' },
        { key: 'carts_updated_converted', label: 'Convertis', color: 'chart-2', format: 'number' },
      ],
      defaultRange: { kind: 'preset', preset: '30d' },
    },
    {
      type: 'ChartCard',
      id: 'visitor-stats-identity-acquisitions',
      variant: 'bar',
      title: 'Acquisitions email par jour',
      description: 'Newsletter (Klaviyo) vs checkout_started.',
      query: { name: 'visitor-stats-identity-acquisitions' },
      xKey: 'date',
      series: [
        { key: 'newsletter', label: 'Newsletter', color: 'chart-1', format: 'number' },
        { key: 'checkout_started', label: 'Checkout started', color: 'chart-2', format: 'number' },
      ],
      defaultRange: { kind: 'preset', preset: '30d' },
      stacked: true,
    },
    {
      type: 'ChartCard',
      id: 'visitor-stats-paid-vs-organic',
      variant: 'line',
      title: 'Sessions paid vs organic',
      description: 'is_paid_session (utm/gclid/fbclid — voir docs/visitor-funnel-rules.md).',
      query: { name: 'visitor-stats-paid-vs-organic' },
      xKey: 'date',
      series: [
        { key: 'paid', label: 'Paid', color: 'chart-4', format: 'number' },
        { key: 'organic', label: 'Organic', color: 'chart-5', format: 'number' },
      ],
      defaultRange: { kind: 'preset', preset: '30d' },
    },
  ],
})
