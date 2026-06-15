import { describe, expect, it } from 'vitest'
import clientsPage from '../src/spa/admin/pages/clients/page'
import ordersPage from '../src/spa/admin/pages/orders/page'
import cartsPage from '../src/spa/admin/pages/paniers/page'

describe('admin exceptional refresh buttons', () => {
  it('exposes dry-run and apply buttons on the orders page', () => {
    expect(ordersPage.header?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'backfillOrdersFromShopify', label: 'Tester refresh orders' }),
        expect.objectContaining({
          command: 'backfillOrdersFromShopifyApply',
          label: 'Réparer orders (lot)',
          destructive: true,
        }),
        expect.objectContaining({
          command: 'resyncOrderAnalyticsApply',
          label: 'Resync analytics orders',
          destructive: true,
        }),
      ]),
    )
  })

  it('does not expose contact aggregate repair buttons on the clients page', () => {
    expect(clientsPage.header?.actions ?? []).toEqual([])
  })

  it('exposes audit, dry-run, and apply buttons on the carts page', () => {
    expect(cartsPage.header?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'auditCartSnapshots', label: 'Auditer carts' }),
        expect.objectContaining({ command: 'repairCartSnapshots', label: 'Tester réparation carts' }),
        expect.objectContaining({
          command: 'repairCartSnapshotsApply',
          label: 'Réparer carts',
          destructive: true,
        }),
      ]),
    )
  })
})
