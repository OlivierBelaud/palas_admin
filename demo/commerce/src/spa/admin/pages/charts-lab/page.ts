// Charts lab — showcase + smoke-test page for the ChartCard framework block.
// Two ChartCard instances with distinct ids validate URL state isolation
// (range_orders-chart vs range_revenue-chart). Synthetic data via the
// `charts-lab-data` named query. Replace with real queries once STATS-09 lands.

import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Charts lab',
  },
  main: [
    {
      type: 'ChartCard',
      id: 'orders-chart',
      variant: 'line',
      title: 'Commandes / jour',
      query: { name: 'charts-lab-data' },
      xKey: 'date',
      series: [{ key: 'orders', label: 'Commandes', color: 'chart-1', format: 'number' }],
      defaultRange: { kind: 'preset', preset: '30d' },
    },
    {
      type: 'ChartCard',
      id: 'revenue-chart',
      variant: 'bar',
      title: 'CA / jour',
      query: { name: 'charts-lab-data' },
      xKey: 'date',
      series: [{ key: 'revenue', label: 'CA', color: 'chart-2', format: 'currency' }],
      defaultRange: { kind: 'preset', preset: '7d' },
    },
  ],
})
