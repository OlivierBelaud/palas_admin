import { describe, expect, it } from 'vitest'
import clientsPage from '../src/spa/admin/pages/clients/page'
import ordersPage from '../src/spa/admin/pages/orders/page'

describe('admin exceptional refresh buttons', () => {
  it('exposes dry-run and apply buttons on the orders page', () => {
    expect(ordersPage.header?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'backfillOrderSnapshots', label: 'Tester refresh orders' }),
        expect.objectContaining({
          command: 'backfillOrderSnapshotsApply',
          label: 'Réparer orders (lot)',
          destructive: true,
        }),
      ]),
    )
  })

  it('exposes dry-run and apply buttons on the clients page', () => {
    expect(clientsPage.header?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'reconcileContactSnapshots', label: 'Tester consolidation' }),
        expect.objectContaining({
          command: 'reconcileContactSnapshotsApply',
          label: 'Réparer contacts',
          destructive: true,
        }),
      ]),
    )
  })
})
